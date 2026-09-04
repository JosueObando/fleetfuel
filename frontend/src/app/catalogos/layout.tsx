import { ShellApp } from '@/componentes/ShellApp/ShellApp';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ShellApp>{children}</ShellApp>;
}
