import { handlers } from "@/lib/auth/auth";

/** Auth.js sign-in, callback and sign-out endpoints. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = handlers;
