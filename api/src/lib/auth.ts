import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { HttpRequest } from "@azure/functions";
import { getPool, sql } from "./db";

export const COOKIE = "fich_sesion";
const DURACION_SESION_H = 10;
const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
// Hash ficticio para igualar tiempos cuando el email no existe
let hashFicticio: string | null = null;
const getHashFicticio = () => (hashFicticio ??= bcrypt.hashSync("usuario-inexistente", 12));

export type Rol = "EMPLEADO" | "RESPONSABLE" | "RRHH" | "ADMIN";
export const ROLES: Rol[] = ["EMPLEADO", "RESPONSABLE", "RRHH", "ADMIN"];

export interface UsuarioSesion {
  usuarioId: number;
  email: string;
  nombre: string;
  apellidos: string;
  rol: Rol;
  empresaId: number;
  debeCambiarPassword: boolean;
}

function secreto(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("JWT_SECRET no configurado o demasiado corto");
  return s;
}

export function validarPassword(pw: unknown): string | null {
  if (typeof pw !== "string") return "Contraseña no válida";
  if (pw.length < 10) return "La contraseña debe tener al menos 10 caracteres";
  if (pw.length > 128) return "La contraseña es demasiado larga";
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(pw) || !/\d/.test(pw)) return "La contraseña debe incluir letras y números";
  return null;
}

export function validarEmail(email: unknown): email is string {
  return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);

export function crearToken(usuarioId: number, versionSesion: number): string {
  return jwt.sign({ uid: usuarioId, v: versionSesion }, secreto(), { expiresIn: `${DURACION_SESION_H}h`, algorithm: "HS256" });
}

export function cookieSesion(token: string) {
  return {
    name: COOKIE,
    value: token,
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Strict" as const,
    maxAge: DURACION_SESION_H * 3600,
  };
}

export function cookieBorrada() {
  return { name: COOKIE, value: "", path: "/", httpOnly: true, secure: true, sameSite: "Strict" as const, maxAge: 0 };
}

function leerCookie(req: HttpRequest, nombre: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const parte of raw.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function ipCliente(req: HttpRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return null;
  return xff.split(",")[0].trim().replace(/:\d+$/, "").slice(0, 45);
}

/** Devuelve el usuario de la sesión o null. Revalida contra BD (activo y versión de sesión). */
export async function usuarioDeSesion(req: HttpRequest): Promise<UsuarioSesion | null> {
  const token = leerCookie(req, COOKIE);
  if (!token) return null;
  let payload: any;
  try {
    payload = jwt.verify(token, secreto(), { algorithms: ["HS256"] });
  } catch {
    return null;
  }
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, payload.uid)
    .query(
      `SELECT UsuarioId, Email, Nombre, Apellidos, Rol, EmpresaId, DebeCambiarPassword, Activo, VersionSesion
         FROM fich.Usuarios WHERE UsuarioId = @id`
    );
  const u = r.recordset[0];
  if (!u || !u.Activo || u.VersionSesion !== payload.v) return null;
  return {
    usuarioId: u.UsuarioId,
    email: u.Email,
    nombre: u.Nombre,
    apellidos: u.Apellidos,
    rol: u.Rol,
    empresaId: u.EmpresaId,
    debeCambiarPassword: !!u.DebeCambiarPassword,
  };
}

export type ResultadoLogin =
  | { ok: true; token: string; usuario: UsuarioSesion }
  | { ok: false; motivo: "credenciales" | "bloqueado" };

export async function login(email: string, password: string): Promise<ResultadoLogin> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar(254), email.trim().toLowerCase())
    .query(
      `SELECT UsuarioId, Email, Nombre, Apellidos, Rol, EmpresaId, PasswordHash, DebeCambiarPassword,
              Activo, IntentosFallidos, BloqueadoHastaUtc, VersionSesion
         FROM fich.Usuarios WHERE EmailNormalizado = @email`
    );
  const u = r.recordset[0];

  if (!u || !u.Activo) {
    await bcrypt.compare(password, getHashFicticio());
    return { ok: false, motivo: "credenciales" };
  }
  if (u.BloqueadoHastaUtc && new Date(u.BloqueadoHastaUtc) > new Date()) {
    return { ok: false, motivo: "bloqueado" };
  }

  const valido = await bcrypt.compare(password, u.PasswordHash);
  if (!valido) {
    await pool
      .request()
      .input("id", sql.Int, u.UsuarioId)
      .input("max", sql.Int, MAX_INTENTOS)
      .input("min", sql.Int, BLOQUEO_MIN)
      .query(
        `UPDATE fich.Usuarios
            SET IntentosFallidos = CASE WHEN IntentosFallidos + 1 >= @max THEN 0 ELSE IntentosFallidos + 1 END,
                BloqueadoHastaUtc = CASE WHEN IntentosFallidos + 1 >= @max THEN DATEADD(MINUTE, @min, SYSUTCDATETIME()) ELSE BloqueadoHastaUtc END
          WHERE UsuarioId = @id`
      );
    return { ok: false, motivo: "credenciales" };
  }

  await pool
    .request()
    .input("id", sql.Int, u.UsuarioId)
    .query(
      `UPDATE fich.Usuarios SET IntentosFallidos = 0, BloqueadoHastaUtc = NULL, UltimoAccesoUtc = SYSUTCDATETIME()
        WHERE UsuarioId = @id`
    );

  return {
    ok: true,
    token: crearToken(u.UsuarioId, u.VersionSesion),
    usuario: {
      usuarioId: u.UsuarioId,
      email: u.Email,
      nombre: u.Nombre,
      apellidos: u.Apellidos,
      rol: u.Rol,
      empresaId: u.EmpresaId,
      debeCambiarPassword: !!u.DebeCambiarPassword,
    },
  };
}
