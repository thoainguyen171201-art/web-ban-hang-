import labels from "./thoai-labels.json" with { type: "json" };
import { defaults } from "./site-data.ts";
export const pageCopyDefaults = defaults.pageContent;
export const pageCopyLabels: Record<string,{title:string;sections:Record<string,{label:string;fields:Record<string,string>}>}> = labels.pageLabels;
