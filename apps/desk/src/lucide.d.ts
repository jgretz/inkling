/**
 * lucide-react ships one declaration file for its barrel and none for the
 * per-icon modules. The icons are imported one module at a time so the bundler
 * never walks the barrel's thousands of re-exports, and this restores the types
 * that entry point loses.
 */
declare module 'lucide-react/dist/esm/icons/*' {
  import type {LucideIcon} from 'lucide-react';

  const icon: LucideIcon;
  export default icon;
}
