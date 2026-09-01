import { Suspense } from "react";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { QueryProvider } from "@/components/chat/QueryProvider";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ s?: string }>;
}

export default async function ChatPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const params = await searchParams;
  const initial = params.s ?? null;

  return (
    <QueryProvider>
      <Suspense fallback={null}>
        <ChatLayout initialSessionId={initial} />
      </Suspense>
    </QueryProvider>
  );
}
