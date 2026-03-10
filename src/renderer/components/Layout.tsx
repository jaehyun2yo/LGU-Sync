import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { NotificationCenter } from './NotificationCenter'
import { ConfirmDialog } from './ConfirmDialog'
import { ToastContainer } from './ToastContainer'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <Header />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
      <NotificationCenter />
      <ConfirmDialog />
      <ToastContainer />
    </div>
  )
}
