import { http, HttpResponse } from 'msw'

const BASE_URL = 'https://only.webhard.co.kr'
const DOWNLOAD_SERVER = 'https://whfile1.webhard.co.kr'

// Simulated session store
let validSession = false
const sessionCookie = 'JSESSIONID=mock-session-123; WMONID=mock-wmon-456'

export function resetMockSession(): void {
  validSession = false
}

// ── Mock data ──

const MOCK_FOLDERS = [
  { FOLDER_ID: 1001, FOLDER_NAME: '올리기전용', UPPER_FOLDER_ID: 1000, SUB_CNT: 5 },
  { FOLDER_ID: 1002, FOLDER_NAME: '내리기전용', UPPER_FOLDER_ID: 1000, SUB_CNT: 3 },
]

const MOCK_FILE_LIST = [
  {
    ITEM_ID: 5001,
    ITEM_NAME: 'test.dxf',
    ITEM_SIZE: 10240,
    ITEM_EXTENSION: 'dxf',
    ITEM_PARENT_ID: 1001,
    ITEM_UPDT_DT: '2026-02-23 10:00:00',
    FOLDER_TY_CODE: undefined, // file, not folder
  },
]

const MOCK_HISTORY = [
  {
    HISTORY_NO: 101,
    ITEM_SRC_NO: 5001,
    ITEM_FOLDER_ID: 1001,
    ITEM_SRC_NAME: 'drawing1',
    ITEM_SRC_EXTENSION: 'dxf',
    ITEM_SRC_TYPE: 'file',
    ITEM_FOLDER_FULLPATH: '/올리기전용/원컴퍼니/',
    ITEM_OPER_CODE: 'U',
    ITEM_USE_DATE: '2026-02-23 10:00:00',
  },
  {
    HISTORY_NO: 100,
    ITEM_SRC_NO: 5002,
    ITEM_FOLDER_ID: 1001,
    ITEM_SRC_NAME: 'drawing2',
    ITEM_SRC_EXTENSION: 'dxf',
    ITEM_SRC_TYPE: 'file',
    ITEM_FOLDER_FULLPATH: '/올리기전용/대성목형/',
    ITEM_OPER_CODE: 'U',
    ITEM_USE_DATE: '2026-02-23 09:30:00',
  },
]

// ── Helper ──

function requireSession(): HttpResponse | null {
  if (!validSession) {
    return HttpResponse.json(
      { RESULT_CODE: '9999', RESULT_MSG: '로그인이 필요합니다' },
      { status: 200 },
    )
  }
  return null
}

// ── Handlers ──

export const lguplusHandlers = [
  // Step 1: GET /login — return login page HTML + initial cookies
  http.get(`${BASE_URL}/login`, () => {
    return new HttpResponse('<html><title>Login</title></html>', {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Set-Cookie': 'WMONID=init-cookie-123; Path=/',
      },
    })
  }),

  // Step 2: POST /login-process — form-based login
  http.post(`${BASE_URL}/login-process`, async ({ request }) => {
    const body = await request.text()
    const params = new URLSearchParams(body)
    const loginId = params.get('loginId')
    const password = params.get('password')
    const userType = params.get('userType')

    if (loginId === 'testuser' && password === 'testpass' && userType === 'Manage') {
      validSession = true
      return new HttpResponse(null, {
        status: 302,
        headers: {
          Location: '/folders/home',
          'Set-Cookie': sessionCookie,
        },
      })
    }

    // Failed login — redirect back to login page
    return new HttpResponse(null, {
      status: 302,
      headers: { Location: '/login?error=1' },
    })
  }),

  // Step 3: GET /folders/home — login verification page
  http.get(`${BASE_URL}/folders/home`, () => {
    if (validSession) {
      return new HttpResponse(
        '<html><body>내 폴더<a href="/logout">로그아웃</a>myFolderCnt</body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )
    }
    return new HttpResponse(null, {
      status: 302,
      headers: { Location: '/login' },
    })
  }),

  // Logout
  http.post(`${BASE_URL}/logout`, () => {
    validSession = false
    return HttpResponse.json({ result: 'success' })
  }),

  // ── Main API: POST /wh ──
  http.post(`${BASE_URL}/wh`, async ({ request }) => {
    const authErr = requireSession()
    if (authErr) return authErr

    const body = (await request.json()) as Record<string, unknown>
    const msgType = body.MESSAGE_TYPE as string
    const procType = body.PROCESS_TYPE as string

    // FOLDER / TREE — folder tree listing
    if (msgType === 'FOLDER' && procType === 'TREE') {
      const upperId = body.UPPER_ID as number
      if (upperId === 0) {
        return HttpResponse.json({
          RESULT_CODE: '0000',
          RESULT_MSG: 'OK',
          ITEM_FOLDER: [
            { FOLDER_ID: 1000, FOLDER_NAME: 'HOME', UPPER_FOLDER_ID: 0, SUB_CNT: 2 },
          ],
        })
      }
      if (upperId === 1000) {
        return HttpResponse.json({
          RESULT_CODE: '0000',
          RESULT_MSG: 'OK',
          ITEM_FOLDER: MOCK_FOLDERS,
        })
      }
      return HttpResponse.json({
        RESULT_CODE: '0000',
        RESULT_MSG: 'OK',
        ITEM_FOLDER: [],
      })
    }

    // FOLDER / LIST — folder contents
    if (msgType === 'FOLDER' && procType === 'LIST') {
      const requestId = body.REQUEST_ID as number
      if (requestId === 1001) {
        return HttpResponse.json({
          RESULT_CODE: '0000',
          RESULT_MSG: 'OK',
          TOTAL: 1,
          VIEW: 100,
          ITEMS: MOCK_FILE_LIST,
        })
      }
      return HttpResponse.json({
        RESULT_CODE: '0000',
        RESULT_MSG: 'OK',
        TOTAL: 0,
        VIEW: 100,
        ITEMS: [],
      })
    }

    // USE_HISTORY / LIST — upload history
    if (msgType === 'USE_HISTORY' && procType === 'LIST') {
      return HttpResponse.json({
        RESULT_CODE: '0000',
        RESULT_MSG: 'OK',
        ITEM_TOTAL: 2,
        ITEM_VIEW: 20,
        ITEM_HISTORY: MOCK_HISTORY,
      })
    }

    return HttpResponse.json({ RESULT_CODE: '9999', RESULT_MSG: 'Unknown request' })
  }),

  // ── Download URL info: GET /downloads/:fileId/server ──
  http.get(`${BASE_URL}/downloads/:fileId/server`, ({ params }) => {
    if (!validSession) {
      return new HttpResponse(null, { status: 302, headers: { Location: '/login' } })
    }

    const fileId = Number(params.fileId)
    if (fileId === 9999) {
      return HttpResponse.json({ error: 'not found' }, { status: 404 })
    }

    return HttpResponse.json({
      file: {
        fileManagementNumber: fileId,
        fileName: 'test.dxf',
        fileSize: 10240,
        fileOwnerId: 1,
        path: '/guest/올리기전용/',
      },
      session: 'dl-session-123',
      nonce: 'nonce-abc',
      certificationId: 'webhard3.0',
      certificationKey: 'Hw9mJtbPPX57yV661Qlx',
      userId: 'testuser',
      url: `${DOWNLOAD_SERVER}/file/download`,
      fileOwnerEncId: 'enc-owner-1',
    })
  }),

  // ── Actual file download ──
  http.get(`${DOWNLOAD_SERVER}/file/download`, ({ request }) => {
    const url = new URL(request.url)
    const fileId = url.searchParams.get('fileManagementNumber')

    if (fileId === '9999') {
      return new HttpResponse(null, { status: 404 })
    }

    const content = Buffer.alloc(10240, 0x41)
    return new HttpResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': '10240',
      },
    })
  }),
]
