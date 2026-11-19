import { renderSite } from "../../server/site";
export const dynamic = "force-dynamic";
export function GET() { return renderSite(); }
