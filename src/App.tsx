import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import { CartProvider } from './hooks/useCart'
import { Layout } from './components/common/Layout'
import { ProtectedRoute } from './components/common/ProtectedRoute'
import { CatalogPage } from './pages/CatalogPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { ConfirmEmailPage } from './pages/ConfirmEmailPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { AccountPage } from './pages/AccountPage'
import { OrderPage } from './pages/OrderPage'
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage'
import { AdminProductsPage } from './pages/admin/AdminProductsPage'
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage'
import { AdminClientsPage } from './pages/admin/AdminClientsPage'
import { AdminConfigPage } from './pages/admin/AdminConfigPage'
import { AdminStoresPage } from './pages/admin/AdminStoresPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { AdminWhatsAppPage } from './pages/admin/AdminWhatsAppPage'

export default function App() {
  return <BrowserRouter>
    <AuthProvider><CartProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<CatalogPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="cadastro" element={<SignupPage />} />
          <Route path="confirmar-email" element={<ConfirmEmailPage />} />
          <Route path="recuperar-senha" element={<ResetPasswordPage />} />
          <Route path="conta" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
          <Route path="pedido/:id" element={<ProtectedRoute><OrderPage /></ProtectedRoute>} />
          <Route path="admin" element={<ProtectedRoute admin><AdminDashboardPage /></ProtectedRoute>} />
          <Route path="admin/lojas" element={<ProtectedRoute superAdmin><AdminStoresPage /></ProtectedRoute>} />
          <Route path="admin/produtos" element={<ProtectedRoute admin><AdminProductsPage /></ProtectedRoute>} />
          <Route path="admin/pedidos" element={<ProtectedRoute admin><AdminOrdersPage /></ProtectedRoute>} />
          <Route path="admin/clientes" element={<ProtectedRoute superAdmin><AdminClientsPage /></ProtectedRoute>} />
          <Route path="admin/whatsapp" element={<ProtectedRoute superAdmin><AdminWhatsAppPage /></ProtectedRoute>} />
          <Route path="admin/config" element={<ProtectedRoute admin><AdminConfigPage /></ProtectedRoute>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </CartProvider></AuthProvider>
  </BrowserRouter>
}
