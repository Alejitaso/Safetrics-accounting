import {
  LayoutDashboard, ShoppingCart, Package, Receipt, RefreshCw,
  CalendarRange, ChartNoAxesCombined, FolderTree, HardDrive, Settings
} from 'lucide-react';

export const modules = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard },
  { id: 'ventas', label: 'Ventas', icon: ShoppingCart, badge: true },
  { id: 'productos', label: 'Productos', icon: Package },
  { id: 'gastos', label: 'Gastos', icon: Receipt },
  { id: 'suscripciones', label: 'Suscripciones', icon: RefreshCw },
  { id: 'gastos-prolongados', label: 'Gastos prolongados', icon: CalendarRange },
  { id: 'comparativas', label: 'Comparativas', icon: ChartNoAxesCombined },
  { id: 'catalogos', label: 'Catálogos', icon: FolderTree },
  { id: 'respaldo', label: 'Respaldo', icon: HardDrive },
  { id: 'configuracion', label: 'Configuración', icon: Settings }
];

export const pageTitles = Object.fromEntries(modules.map(({ id, label }) => [id, label]));
