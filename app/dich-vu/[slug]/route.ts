import { renderSite } from "../../../server/site";
export const dynamic = "force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}) {
  return renderSite((await params).slug);
}
