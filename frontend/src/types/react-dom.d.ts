// react-dom ships without types here (the app never imported it before); the
// web build uses createPortal for the glass tab bar (src/components/GlassTabBar.tsx).
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactPortal;
}
