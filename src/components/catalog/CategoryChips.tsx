import type { Category } from '../../types'

export function CategoryChips({ categories, active, onChange }: { categories: Category[], active: string, onChange: (id: string) => void }) {
  return <div className="chips" role="list" aria-label="Categorias">
    <button className={`chip ${active === 'all' ? 'active' : ''}`} onClick={() => onChange('all')}>Todos</button>
    {categories.map((category) => <button key={category.id} className={`chip ${active === category.id ? 'active' : ''}`} onClick={() => onChange(category.id)}>{category.name}</button>)}
  </div>
}
