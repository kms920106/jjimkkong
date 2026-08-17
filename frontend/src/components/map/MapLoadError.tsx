import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * The three provider components fail the same way — a missing key, a domain
 * that is not on the console's allowlist, or a script that never defined its
 * namespace — so they share one surface rather than three copies of it.
 *
 * `title` is the whole sentence, not a provider name with a particle appended:
 * 카카오맵 takes 을 and 네이버 지도 takes 를, and that is a property of the
 * name rather than something this component can work out.
 *
 * It fills the map's own box. The map is the entire viewport on the home page,
 * so an alert pinned to the top of an otherwise blank screen would read as a
 * page that failed to load rather than a map that did.
 */
export default function MapLoadError({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-muted p-6">
      <Alert variant="destructive" className="max-w-sm">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{detail}</AlertDescription>
      </Alert>
    </div>
  );
}
