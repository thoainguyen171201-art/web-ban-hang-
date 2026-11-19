import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sql } from "./db";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const cookieName = "thoai_admin";
const maxAge = 8 * 60 * 60;
export const authReady = () => Boolean(process.env.ADMIN_USERNAME && /^[\da-f]{32}:[\da-f]{128}$/.test(process.env.ADMIN_PASSWORD_HASH ?? ""));

export async function session() {
  const value = (await cookies()).get(cookieName)?.value;
  if (!authReady() || !process.env.DATABASE_URL || !value || !/^[\da-f]{64}$/.test(value)) return null;
  const rows = await sql()`SELECT 1 FROM thoai_sessions WHERE token_hash = ${hash(value)} AND expires_at > now()`;
  return rows.length ? value : null;
}

export function sameOrigin(request: Request) {
  const host = request.headers.get("host");
  const protocol = process.env.VERCEL ? "https:" : new URL(request.url).protocol;
  if (!host || request.headers.get("origin") !== protocol + "//" + host) throw new HttpError(403, "Nguồn yêu cầu không hợp lệ.");
}

export async function limit(request: Request, prefix: string, maximum: number, seconds: number) {
  const ip = request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() || "local";
  const key = prefix + ":" + hash(ip);
  const [row] = await sql()`INSERT INTO thoai_limits (key, started_at, hits)
    VALUES (${key}, now(), 1) ON CONFLICT (key) DO UPDATE SET
    hits = CASE WHEN thoai_limits.started_at <= now() - ${seconds} * interval '1 second' THEN 1 ELSE LEAST(thoai_limits.hits + 1, ${maximum+1}) END,
    started_at = CASE WHEN thoai_limits.started_at <= now() - ${seconds} * interval '1 second' THEN now() ELSE thoai_limits.started_at END
    RETURNING hits`;
  if (row.hits > maximum) throw new HttpError(429, "Bạn đã gửi quá nhiều lần. Vui lòng thử lại sau.");
}

export async function login(request: Request, username: string, password: string) {
  if (!authReady() || !process.env.DATABASE_URL) throw new HttpError(503, "Chưa cấu hình tài khoản hoặc cơ sở dữ liệu.");
  await limit(request, "admin", 8, 900);
  const [salt, digest] = process.env.ADMIN_PASSWORD_HASH!.split(":");
  if (!timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(digest, "hex")) || username !== process.env.ADMIN_USERNAME) {
    throw new HttpError(401, "Tài khoản hoặc mật khẩu chưa đúng.");
  }
  const token = randomBytes(32).toString("hex");
  const cookie = await cookies();
  const previous = cookie.get(cookieName)?.value;
  const db = sql();
  await db.transaction([
    db`DELETE FROM thoai_sessions WHERE expires_at <= now() OR token_hash = ${previous ? hash(previous) : ""}`,
    db`INSERT INTO thoai_sessions (token_hash, expires_at) VALUES (${hash(token)}, now() + ${maxAge} * interval '1 second')`,
    db`DELETE FROM thoai_limits WHERE started_at < now() - interval '2 days'`
  ]);
  cookie.set(cookieName, token, { httpOnly: true, secure: Boolean(process.env.VERCEL), sameSite: "strict", path: "/", maxAge });
}

export async function body(request: Request, max = 32_000) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new HttpError(415, "Định dạng yêu cầu không hỗ trợ.");
  if (Number(request.headers.get("content-length")) > max) throw new HttpError(413, "Dữ liệu vượt giới hạn.");
  const text = await request.text();
  if (Buffer.byteLength(text) > max) throw new HttpError(413, "Dữ liệu vượt giới hạn.");
  try { return JSON.parse(text) as unknown; } catch { throw new HttpError(400, "Dữ liệu gửi lên không hợp lệ."); }
}

export function failure(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  if ((error as {code?:string})?.code === "42P01") {
    console.error("Neon chưa khởi tạo. Chạy npm run db:init.");
    return Response.json({error:"Cơ sở dữ liệu chưa được khởi tạo. Quản trị viên cần chạy npm run db:init."},{status:503});
  }
  console.error(error instanceof Error ? error.name : "Error", (error as {code?:string})?.code ?? "");
  return Response.json({ error: "Hệ thống đang bận. Vui lòng thử lại." }, { status: 500 });
}
