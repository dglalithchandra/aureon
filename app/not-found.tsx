import { BrandedError } from "@/components/BrandedError";

export default function NotFound(): React.ReactElement {
  return (
    <BrandedError
      title="Page not found."
      message="The link may have expired, or you don't own this session. The 24h session window starts when you submit your first prompt."
    />
  );
}
