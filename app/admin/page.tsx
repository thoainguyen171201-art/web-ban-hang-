import type { Metadata } from "next";
import { authReady, session } from "../../server/http";
import { Admin } from "./admin";
import "./admin.css";

export const metadata: Metadata = { title: "Quản trị | Nguyễn Thị Hồng Thoại", robots: { index:false, follow:false } };
export default async function AdminPage() {
  return <Admin authenticated={Boolean(await session())} configured={authReady() && Boolean(process.env.DATABASE_URL)} />;
}
