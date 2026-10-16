// Kubernetes probe target: answers from this pod without rendering or calling the API, so the probe reflects only
// whether this Next.js process is serving.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok' });
}
