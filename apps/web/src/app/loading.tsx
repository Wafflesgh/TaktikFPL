// Kerangka (skeleton) Beranda selama data dimuat — bentuknya mengikuti layout 3 kolom.
function Block({ className = "" }: { className?: string }) {
  return <div className={`glass animate-pulse ${className}`} />;
}

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pb-28 pt-4 lg:px-8 lg:pb-10" aria-busy="true">
      <span className="sr-only">Loading data…</span>
      <Block className="h-16" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-4 xl:col-span-3">
          <Block className="h-80" />
          <Block className="h-72" />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-8 xl:col-span-6">
          <Block className="h-80" />
          <Block className="h-96" />
        </div>
        <div className="hidden flex-col gap-6 xl:col-span-3 xl:flex">
          <Block className="h-80" />
          <Block className="h-[28rem]" />
        </div>
      </div>
    </div>
  );
}
