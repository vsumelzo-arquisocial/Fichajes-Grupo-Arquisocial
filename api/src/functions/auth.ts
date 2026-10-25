import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import {
  login,
  cookieSesion,
  cookieBorrada,
  hashPassword,
  validarPassword,
  validarEmail,
  crearToken,
  ipCliente,
  leerConfig,
} from "../lib/auth";
import { json, error, leerJson, conSesion, publico } from "../lib/http";
import { auditar } from "../lib/auditoria";
import bcrypt from "bcryptjs";
import crypto from "crypto";

/* ---------- ¿Hace falta configuración inicial? ---------- */
app.http("setupEstado", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "setup/estado",
  handler: publico(async () => {
    const pool = await getPool();
    const r = await pool.request().query("SELECT COUNT(*) AS n FROM fich.Usuarios");
    const clave = process.env.SETUP_KEY || (await leerConfig("SETUP_KEY"));
    return json(200, { necesitaSetup: r.recordset[0].n === 0 && !!clave });
  }),
});

/* ---------- Crear primer administrador (solo si no hay usuarios y con SETUP_KEY) ---------- */
app.http("setup", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "setup",
  handler: publico(async (req) => {
    const claveEsperada = process.env.SETUP_KEY || (await leerConfig("SETUP_KEY"));
    if (!claveEsperada) return error(404, "No disponible");
    const b = await leerJson(req);
    if (!b) return error(400, "Datos no válidos");

    const clave = String(b.setupKey ?? "");
    const a = Buffer.from(clave);
    const e = Buffer.from(claveEsperada);
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return error(403, "Clave de configuración incorrecta");

    if (!validarEmail(b.email)) return error(400, "Email no válido");
    if (!b.nombre || !b.apellidos || !b.empresaId) return error(400, "Faltan datos obligatorios");
    const errPw = validarPassword(b.password);
    if (errPw) return error(400, errPw);

    const hash = await hashPassword(b.password);
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const n = await new sql.Request(tx).query("SELECT COUNT(*) AS n FROM fich.Usuarios WITH (UPDLOCK, HOLDLOCK)");
      if (n.recordset[0].n > 0) {
        await tx.rollback();
        return error(409, "La aplicación ya está configurada");
      }
      const r = await new sql.Request(tx)
        .input("email", sql.NVarChar(254), b.email.trim())
        .input("nombre", sql.NVarChar(100), String(b.nombre).trim())
        .input("apellidos", sql.NVarChar(150), String(b.apellidos).trim())
        .input("empresa", sql.Int, Number(b.empresaId))
        .input("hash", sql.VarChar(255), hash)
        .query(
          `INSERT INTO fich.Usuarios (Email, Nombre, Apellidos, EmpresaId, Rol, PasswordHash, DebeCambiarPassword)
           OUTPUT INSERTED.UsuarioId
           VALUES (@email, @nombre, @apellidos, @empresa, 'ADMIN', @hash, 0)`
        );
      const id = r.recordset[0].UsuarioId;
      await auditar(id, "SETUP_ADMIN", "Usuario", id, b.email, ipCliente(req), tx);
      // La clave de configuración es de un solo uso
      await new sql.Request(tx).query("DELETE FROM fich.Config WHERE Clave = 'SETUP_KEY'");
      await tx.commit();
      return json(201, { ok: true });
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }
  }),
});

/* ---------- Empresas (público: necesario en el formulario de setup) ---------- */
app.http("empresasPublico", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "empresas",
  handler: publico(async () => {
    const pool = await getPool();
    const r = await pool.request().query("SELECT EmpresaId AS id, Nombre AS nombre FROM fich.Empresas WHERE Activa = 1 ORDER BY Nombre");
    return json(200, r.recordset);
  }),
});

/* ---------- Login ---------- */
app.http("login", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/login",
  handler: publico(async (req) => {
    const b = await leerJson(req);
    if (!b || !validarEmail(b.email) || typeof b.password !== "string" || !b.password) {
      return error(400, "Introduce email y contraseña");
    }
    const r = await login(b.email, b.password);
    if (!r.ok) {
      await auditar(null, "LOGIN_FALLIDO", "Usuario", null, `${String(b.email).slice(0, 254)} (${r.motivo})`, ipCliente(req));
      return r.motivo === "bloqueado"
        ? error(423, "Cuenta bloqueada temporalmente por intentos fallidos. Inténtalo en unos minutos.")
        : error(401, "Email o contraseña incorrectos");
    }
    await auditar(r.usuario.usuarioId, "LOGIN", "Usuario", r.usuario.usuarioId, null, ipCliente(req));
    return json(200, { usuario: r.usuario }, { cookies: [cookieSesion(r.token)] });
  }),
});

/* ---------- Logout ---------- */
app.http("logout", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/logout",
  handler: publico(async () => json(200, { ok: true }, { cookies: [cookieBorrada()] })),
});

/* ---------- Usuario actual ---------- */
app.http("me", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "auth/me",
  handler: conSesion(async (_req, _ctx, u) => json(200, { usuario: u }), { permitirCambioPendiente: true }),
});

/* ---------- Cambiar mi contraseña ---------- */
app.http("cambiarPassword", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/cambiar-password",
  handler: conSesion(
    async (req, _ctx, u) => {
      const b = await leerJson(req);
      if (!b || typeof b.actual !== "string") return error(400, "Datos no válidos");
      const errPw = validarPassword(b.nueva);
      if (errPw) return error(400, errPw);
      if (b.actual === b.nueva) return error(400, "La nueva contraseña debe ser distinta de la actual");

      const pool = await getPool();
      const r = await pool.request().input("id", sql.Int, u.usuarioId).query("SELECT PasswordHash, VersionSesion FROM fich.Usuarios WHERE UsuarioId = @id");
      if (!(await bcrypt.compare(b.actual, r.recordset[0].PasswordHash))) return error(400, "La contraseña actual no es correcta");

      const hash = await hashPassword(b.nueva);
      const nuevaVersion = r.recordset[0].VersionSesion + 1;
      await pool
        .request()
        .input("id", sql.Int, u.usuarioId)
        .input("hash", sql.VarChar(255), hash)
        .input("v", sql.Int, nuevaVersion)
        .query(
          `UPDATE fich.Usuarios SET PasswordHash = @hash, DebeCambiarPassword = 0, VersionSesion = @v, ModificadoUtc = SYSUTCDATETIME()
            WHERE UsuarioId = @id`
        );
      await auditar(u.usuarioId, "CAMBIO_PASSWORD", "Usuario", u.usuarioId, null, ipCliente(req));
      // Invalida otras sesiones y emite una nueva para esta
      return json(200, { ok: true }, { cookies: [cookieSesion(await crearToken(u.usuarioId, nuevaVersion))] });
    },
    { permitirCambioPendiente: true }
  ),
});
