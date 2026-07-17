import { CairoClock } from './cairo-clock';

export function Topbar({ title }: { title?: string }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-paper/95 px-6 backdrop-blur">
      <h1 className="text-base font-semibold">{title}</h1>
      <CairoClock />
    </header>
  );
}
