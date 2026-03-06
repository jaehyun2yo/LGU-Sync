import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StateManager } from '../../src/core/state-manager'
import { Logger } from '../../src/core/logger'
import type { SyncFileInsert, SyncFolderInsert, SyncEventInsert, DlqInsert } from '../../src/core/db/types'

describe('StateManager', () => {
  let sm: StateManager
  let logger: Logger

  beforeEach(() => {
    logger = new Logger({ minLevel: 'error' })
    sm = new StateManager(':memory:', logger)
    sm.initialize()
  })

  afterEach(() => {
    sm.close()
  })

  // ── Lifecycle ──

  describe('initialize / close', () => {
    it('initialize()로 모든 테이블이 생성된다', () => {
      // If we got here without error, tables were created
      const folders = sm.getFolders()
      expect(folders).toEqual([])
    })

    it('close() 후 재초기화 가능하다', () => {
      sm.close()
      const sm2 = new StateManager(':memory:', logger)
      sm2.initialize()
      expect(sm2.getFolders()).toEqual([])
      sm2.close()
    })
  })

  // ── Checkpoints ──

  describe('Checkpoints', () => {
    it('saveCheckpoint/getCheckpoint로 값을 저장하고 조회한다', () => {
      sm.saveCheckpoint('last_history_no', '12345')
      expect(sm.getCheckpoint('last_history_no')).toBe('12345')
    })

    it('존재하지 않는 키는 null을 반환한다', () => {
      expect(sm.getCheckpoint('nonexistent')).toBeNull()
    })

    it('같은 키에 대해 upsert된다', () => {
      sm.saveCheckpoint('last_history_no', '100')
      sm.saveCheckpoint('last_history_no', '200')
      expect(sm.getCheckpoint('last_history_no')).toBe('200')
    })
  })

  // ── Sync Folders ──

  describe('Sync Folders', () => {
    const folderInsert: SyncFolderInsert = {
      lguplus_folder_id: 'lg_folder_1',
      lguplus_folder_name: '원컴퍼니',
    }

    it('saveFolder()로 폴더를 저장하고 ID를 반환한다', () => {
      const id = sm.saveFolder(folderInsert)
      expect(id).toBeTruthy()
      expect(typeof id).toBe('string')
    })

    it('getFolder()로 저장된 폴더를 조회한다', () => {
      const id = sm.saveFolder(folderInsert)
      const folder = sm.getFolder(id)
      expect(folder).toBeTruthy()
      expect(folder!.lguplus_folder_name).toBe('원컴퍼니')
      expect(folder!.enabled).toBe(true)
    })

    it('getFolders()로 모든 폴더를 조회한다', () => {
      sm.saveFolder(folderInsert)
      sm.saveFolder({ lguplus_folder_id: 'lg_folder_2', lguplus_folder_name: '대성목형' })
      const folders = sm.getFolders()
      expect(folders).toHaveLength(2)
    })

    it('getFolders(true)로 활성 폴더만 조회한다', () => {
      const id1 = sm.saveFolder(folderInsert)
      sm.saveFolder({ lguplus_folder_id: 'lg_folder_2', lguplus_folder_name: '대성목형' })
      sm.updateFolder(id1, { enabled: false })

      const enabledOnly = sm.getFolders(true)
      expect(enabledOnly).toHaveLength(1)
      expect(enabledOnly[0].lguplus_folder_name).toBe('대성목형')
    })

    it('updateFolder()로 폴더 정보를 업데이트한다', () => {
      const id = sm.saveFolder(folderInsert)
      sm.updateFolder(id, { company_name: '유진레이저', files_synced: 10 })
      const folder = sm.getFolder(id)
      expect(folder!.company_name).toBe('유진레이저')
      expect(folder!.files_synced).toBe(10)
    })
  })

  // ── Sync Files ──

  describe('Sync Files', () => {
    let folderId: string

    beforeEach(() => {
      folderId = sm.saveFolder({
        lguplus_folder_id: 'lg_f1',
        lguplus_folder_name: 'test_folder',
      })
    })

    const makeFileInsert = (overrides?: Partial<SyncFileInsert>): SyncFileInsert => ({
      folder_id: folderId,
      file_name: 'test.dxf',
      file_path: '/uploads/test.dxf',
      file_size: 1024,
      detected_at: new Date().toISOString(),
      ...overrides,
    })

    it('saveFile()로 파일을 저장하고 ID를 반환한다', () => {
      const id = sm.saveFile(makeFileInsert())
      expect(id).toBeTruthy()
    })

    it('getFile()로 저장된 파일을 조회한다', () => {
      const id = sm.saveFile(makeFileInsert())
      const file = sm.getFile(id)
      expect(file).toBeTruthy()
      expect(file!.file_name).toBe('test.dxf')
      expect(file!.status).toBe('detected')
    })

    it('updateFileStatus()로 파일 상태를 업데이트한다', () => {
      const id = sm.saveFile(makeFileInsert())
      sm.updateFileStatus(id, 'downloading')
      const file = sm.getFile(id)
      expect(file!.status).toBe('downloading')
    })

    it('updateFileStatus()에 추가 데이터를 전달할 수 있다', () => {
      const id = sm.saveFile(makeFileInsert())
      sm.updateFileStatus(id, 'completed', {
        download_path: '/tmp/test.dxf',
        md5_hash: 'abc123',
      })
      const file = sm.getFile(id)
      expect(file!.status).toBe('completed')
      expect(file!.download_path).toBe('/tmp/test.dxf')
      expect(file!.md5_hash).toBe('abc123')
    })

    it('getFilesByFolder()로 폴더별 파일을 조회한다', () => {
      sm.saveFile(makeFileInsert({ file_name: 'a.dxf' }))
      sm.saveFile(makeFileInsert({ file_name: 'b.dxf' }))
      const files = sm.getFilesByFolder(folderId)
      expect(files).toHaveLength(2)
    })

    it('getFilesByFolder()에 status 필터를 적용할 수 있다', () => {
      const id1 = sm.saveFile(makeFileInsert({ file_name: 'a.dxf' }))
      sm.saveFile(makeFileInsert({ file_name: 'b.dxf' }))
      sm.updateFileStatus(id1, 'completed')

      const completed = sm.getFilesByFolder(folderId, { status: 'completed' })
      expect(completed).toHaveLength(1)
      expect(completed[0].file_name).toBe('a.dxf')
    })

    it('getFileByHistoryNo()로 historyNo 기반 조회', () => {
      sm.saveFile(makeFileInsert({ history_no: 9999 }))
      const file = sm.getFileByHistoryNo(9999)
      expect(file).toBeTruthy()
      expect(file!.history_no).toBe(9999)
    })

    it('getFileByHistoryNo()에 없는 historyNo는 null 반환', () => {
      expect(sm.getFileByHistoryNo(0)).toBeNull()
    })

    it('getFilesByFolder()에 limit/offset 적용', () => {
      for (let i = 0; i < 5; i++) {
        sm.saveFile(makeFileInsert({ file_name: `file${i}.dxf` }))
      }
      const page = sm.getFilesByFolder(folderId, { limit: 2, offset: 1 })
      expect(page).toHaveLength(2)
    })
  })

  // ── Event Log ──

  describe('Event Log', () => {
    it('logEvent/getEvents로 이벤트를 기록하고 조회한다', () => {
      const event: SyncEventInsert = {
        event_id: 'evt-1',
        event_type: 'file_detected',
        detected_at: new Date().toISOString(),
      }
      sm.logEvent(event)
      const events = sm.getEvents({})
      expect(events).toHaveLength(1)
      expect(events[0].event_id).toBe('evt-1')
    })

    it('getEvents()에 필터를 적용할 수 있다', () => {
      sm.logEvent({
        event_id: 'evt-1',
        event_type: 'file_detected',
        detected_at: '2026-02-23T10:00:00Z',
      })
      sm.logEvent({
        event_id: 'evt-2',
        event_type: 'file_synced',
        detected_at: '2026-02-23T11:00:00Z',
      })

      const filtered = sm.getEvents({ event_type: 'file_detected' })
      expect(filtered).toHaveLength(1)
      expect(filtered[0].event_type).toBe('file_detected')
    })
  })

  // ── DLQ ──

  describe('DLQ (Dead Letter Queue)', () => {
    it('addToDlq/getDlqItems로 DLQ 항목을 추가/조회한다', () => {
      const item: DlqInsert = {
        event_id: 'evt-fail-1',
        file_name: 'fail.dxf',
        file_path: '/uploads/fail.dxf',
        failure_reason: 'download timeout',
      }
      sm.addToDlq(item)
      const dlq = sm.getDlqItems()
      expect(dlq).toHaveLength(1)
      expect(dlq[0].file_name).toBe('fail.dxf')
      expect(dlq[0].failure_reason).toBe('download timeout')
    })

    it('removeDlqItem()으로 DLQ 항목을 제거한다', () => {
      sm.addToDlq({
        event_id: 'evt-fail-2',
        file_name: 'fail2.dxf',
        file_path: '/uploads/fail2.dxf',
        failure_reason: 'upload error',
      })
      const dlq = sm.getDlqItems()
      expect(dlq).toHaveLength(1)

      sm.removeDlqItem(dlq[0].id)
      expect(sm.getDlqItems()).toHaveLength(0)
    })
  })

  // ── Daily Stats ──

  describe('Daily Stats', () => {
    it('incrementDailyStats로 통계를 누적한다', () => {
      sm.incrementDailyStats('2026-02-23', 5, 1, 10240)
      sm.incrementDailyStats('2026-02-23', 3, 0, 5120)

      const stats = sm.getDailyStats('2026-02-23', '2026-02-23')
      expect(stats).toHaveLength(1)
      expect(stats[0].success_count).toBe(8)
      expect(stats[0].failed_count).toBe(1)
      expect(stats[0].total_bytes).toBe(15360)
    })

    it('getDailyStats로 날짜 범위 조회', () => {
      sm.incrementDailyStats('2026-02-21', 1, 0, 100)
      sm.incrementDailyStats('2026-02-22', 2, 0, 200)
      sm.incrementDailyStats('2026-02-23', 3, 0, 300)

      const stats = sm.getDailyStats('2026-02-22', '2026-02-23')
      expect(stats).toHaveLength(2)
    })
  })

  // ── Logs ──

  describe('App Logs', () => {
    it('addLog/getLogs로 로그를 추가하고 조회한다', () => {
      sm.addLog({ level: 'info', message: 'sync started' })
      sm.addLog({ level: 'error', message: 'download failed', category: 'sync' })

      const all = sm.getLogs({})
      expect(all).toHaveLength(2)
    })

    it('getLogs에 레벨 필터를 적용할 수 있다', () => {
      sm.addLog({ level: 'info', message: 'ok' })
      sm.addLog({ level: 'error', message: 'fail' })

      const errors = sm.getLogs({ level: ['error'] })
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('fail')
    })

    it('getLogs에 검색어 필터를 적용할 수 있다', () => {
      sm.addLog({ level: 'info', message: 'sync started for folder A' })
      sm.addLog({ level: 'info', message: 'download completed' })

      const results = sm.getLogs({ search: 'sync' })
      expect(results).toHaveLength(1)
    })

    it('getLogs에 limit 적용', () => {
      for (let i = 0; i < 20; i++) {
        sm.addLog({ level: 'info', message: `log ${i}` })
      }
      const limited = sm.getLogs({ limit: 5 })
      expect(limited).toHaveLength(5)
    })
  })
})
