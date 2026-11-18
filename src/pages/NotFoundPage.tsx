import { Link } from 'react-router-dom'
export function NotFoundPage(){return <div className="container standard-page"><div className="empty-state large"><h1>Página não encontrada</h1><p>O endereço informado não existe.</p><Link className="primary button-link fit" to="/">Voltar ao catálogo</Link></div></div>}
