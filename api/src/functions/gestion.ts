import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { hashPassword, validarEmail, validarPassword, ipCliente, ROLES, Rol } from "../lib/auth";
import { json, error, leerJson, conSesion } from "../lib/http";
import { auditar } from "../lib/auditoria";

// Nota: las rutas no pueden empezar por "admin" (reservado por Azure Functions), por eso "gestion".
const GESTORES: Rol[] = ["ADMIN", "RRHH"];

const SELECT_USUARIO = `
  SELECT u.UsuarioId AS id, u.Email AS email, u.Nombre AS nombre, u.Apellidos AS apellidos,
         u.EmpresaId AS empresaId, e.Nombre AS empresa, u.CentroId AS centroId, c.Nombre AS centro,
         u.Rol AS rol, u.Activo AS activo, u.DebeCambiarPassword AS debeCambiarPassword,
         CASE WHEN u.BloqueadoHastaUtc > SYSUTCDATETIME() THEN 1 ELSE 0 END AS bloqueado,
         u.UltimoAccesoUtc AS ultimoAccesoUtc, u.CreadoUtc AS creadoUtc
    FROM fich.Usuarios u
    JOIN fich.Empresas e ON e.EmpresaId = u.EmpresaId
    LEFT JOIN fich.Centros c ON c.CentroId = u.CentroId`;

/** Solo un ADMIN puede crear/editar otros ADMIN. */
function puedeAsignarRol(actor: Rol, rol: Rol) {
  return rol !== "ADMIN" || actor === "ADMIN";
}

async function centroValido(pool: sql.ConnectionPool, centroId: number | null, empresaId: number) {
  if (centroId === null) return true;
  const r = await pool
    .request()
    .input("c", sql.Int, centroId)
    .input("e", sql.Int, empresaId)
    .query("SELECT 1 AS ok FROM fich.Centros WHERE CentroId = @c AND EmpresaId = @e AND Activo = 1");
  return r.recordset.length > 0;
}

/* ---------- Listar usuarios ---------- */
app.http("gestionUsuariosListar", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/usuarios",
  handler: conSesion(
    async () => {
      const pool = await getPool();
      const r = await pool.request().query(`${SELECT_USUARIO} ORDER BY u.Activo DESC, u.Apellidos, u.Nombre`);
      return json(200, r.recordset);
    },
    { roles: GESTORES }
  ),
});

/* ---------- Crear usuario ---------- */
app.http("gestionUsuariosCrear", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "gestion/usuarios",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const b = await leerJson(req);
      if (!b) return error(400, "Datos no válidos");
      if (!validarEmail(b.email)) return error(400, "Email no válido");
      const nombre = String(b.nombre ?? "").trim();
      const apellidos = String(b.apellidos ?? "").trim();
      if (!nombre || !apellidos) return error(400, "Nombre y apellidos son obligatorios");
      const empresaId = Number(b.empresaId);
      if (!empresaId) return error(400, "Empresa obligatoria");
      const centroId = b.centroId ? Number(b.centroId) : null;
      const rol: Rol = ROLES.includes(b.rol) ? b.rol : "EMPLEADO";
      if (!puedeAsignarRol(actor.rol, rol)) return error(403, "Solo un administrador puede crear administradores");
      const errPw = validarPassword(b.passwordTemporal);
      if (errPw) return error(400, errPw);

      const pool = await getPool();
      if (!(await centroValido(pool, centroId, empresaId))) return error(400, "El centro no pertenece a la empresa");
      const existe = await pool.request().input("e", sql.NVarChar(254), b.email.trim().toLowerCase()).query("SELECT 1 FROM fich.Usuarios WHERE EmailNormalizado = @e");
      if (existe.recordset.length) return error(409, "Ya existe un usuario con ese email");

      const hash = await hashPassword(b.passwordTemporal);
      const r = await pool
        .request()
        .input("email", sql.NVarChar(254), b.email.trim())
        .input("nombre", sql.NVarChar(100), nombre)
        .input("apellidos", sql.NVarChar(150), apellidos)
        .input("empresa", sql.Int, empresaId)
        .input("centro", sql.Int, centroId)
        .input("rol", sql.VarChar(20), rol)
        .input("hash", sql.VarChar(255), hash)
        .query(
          `INSERT INTO fich.Usuarios (Email, Nombre, Apellidos, EmpresaId, CentroId, Rol, PasswordHash, DebeCambiarPassword)
           OUTPUT INSERTED.UsuarioId
           VALUES (@email, @nombre, @apellidos, @empresa, @centro, @rol, @hash, 1)`
        );
      const id = r.recordset[0].UsuarioId;
      await auditar(actor.usuarioId, "CREAR_USUARIO", "Usuario", id, `${b.email} rol=${rol} empresa=${empresaId} centro=${centroId ?? "-"}`, ipCliente(req));
      return json(201, { id });
    },
    { roles: GESTORES }
  ),
});

/* ---------- Editar usuario (datos, rol, activo) ---------- */
app.http("gestionUsuariosEditar", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "gestion/usuarios/{id:int}",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const id = Number(req.params.id);
      const b = await leerJson(req);
      if (!b) return error(400, "Datos no válidos");

      const pool = await getPool();
      const act = await pool.request().input("id", sql.Int, id).query("SELECT Rol, Activo, Email, EmpresaId, CentroId FROM fich.Usuarios WHERE UsuarioId = @id");
      const actual = act.recordset[0];
      if (!actual) return error(404, "Usuario no encontrado");
      if (actual.Rol === "ADMIN" && actor.rol !== "ADMIN") return error(403, "Solo un administrador puede modificar administradores");

      if (!validarEmail(b.email)) return error(400, "Email no válido");
      const nombre = String(b.nombre ?? "").trim();
      const apellidos = String(b.apellidos ?? "").trim();
      if (!nombre || !apellidos) return error(400, "Nombre y apellidos son obligatorios");
      const empresaId = Number(b.empresaId);
      const centroId = b.centroId ? Number(b.centroId) : null;
      const rol: Rol = ROLES.includes(b.rol) ? b.rol : actual.Rol;
      const activo = b.activo !== false;
      if (!puedeAsignarRol(actor.rol, rol)) return error(403, "Solo un administrador puede asignar el rol ADMIN");
      if (id === actor.usuarioId && (!activo || rol !== actor.rol)) return error(400, "No puedes desactivarte ni cambiar tu propio rol");
      if (!(await centroValido(pool, centroId, empresaId))) return error(400, "El centro no pertenece a la empresa");

      const dup = await pool
        .request()
        .input("e", sql.NVarChar(254), b.email.trim().toLowerCase())
        .input("id", sql.Int, id)
        .query("SELECT 1 FROM fich.Usuarios WHERE EmailNormalizado = @e AND UsuarioId <> @id");
      if (dup.recordset.length) return error(409, "Ya existe otro usuario con ese email");

      // Si se desactiva o cambia el rol, se invalidan sus sesiones
      const invalidar = (!activo && actual.Activo) || rol !== actual.Rol ? 1 : 0;
      await pool
        .request()
        .input("id", sql.Int, id)
        .input("email", sql.NVarChar(254), b.email.trim())
        .input("nombre", sql.NVarChar(100), nombre)
        .input("apellidos", sql.NVarChar(150), apellidos)
        .input("empresa", sql.Int, empresaId)
        .input("centro", sql.Int, centroId)
        .input("rol", sql.VarChar(20), rol)
        .input("activo", sql.Bit, activo)
        .input("inv", sql.Int, invalidar)
        .query(
          `UPDATE fich.Usuarios
              SET Email = @email, Nombre = @nombre, Apellidos = @apellidos, EmpresaId = @empresa, CentroId = @centro,
                  Rol = @rol, Activo = @activo, VersionSesion = VersionSesion + @inv, ModificadoUtc = SYSUTCDATETIME()
            WHERE UsuarioId = @id`
        );
      await auditar(
        actor.usuarioId,
        "EDITAR_USUARIO",
        "Usuario",
        id,
        `antes: ${actual.Email} rol=${actual.Rol} activo=${actual.Activo} empresa=${actual.EmpresaId} centro=${actual.CentroId ?? "-"} | despues: ${b.email} rol=${rol} activo=${activo} empresa=${empresaId} centro=${centroId ?? "-"}`,
        ipCliente(req)
      );
      return json(200, { ok: true });
    },
    { roles: GESTORES }
  ),
});

/* ---------- Resetear contraseña (temporal + desbloqueo) ---------- */
app.http("gestionUsuariosResetPassword", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "gestion/usuarios/{id:int}/reset-password",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const id = Number(req.params.id);
      const b = await leerJson(req);
      const errPw = validarPassword(b?.passwordTemporal);
      if (errPw) return error(400, errPw);

      const pool = await getPool();
      const act = await pool.request().input("id", sql.Int, id).query("SELECT Rol FROM fich.Usuarios WHERE UsuarioId = @id");
      if (!act.recordset[0]) return error(404, "Usuario no encontrado");
      if (act.recordset[0].Rol === "ADMIN" && actor.rol !== "ADMIN") return error(403, "Solo un administrador puede resetear a un administrador");

      const hash = await hashPassword(b.passwordTemporal);
      await pool
        .request()
        .input("id", sql.Int, id)
        .input("hash", sql.VarChar(255), hash)
        .query(
          `UPDATE fich.Usuarios
              SET PasswordHash = @hash, DebeCambiarPassword = 1, IntentosFallidos = 0, BloqueadoHastaUtc = NULL,
                  VersionSesion = VersionSesion + 1, ModificadoUtc = SYSUTCDATETIME()
            WHERE UsuarioId = @id`
        );
      await auditar(actor.usuarioId, "RESET_PASSWORD", "Usuario", id, null, ipCliente(req));
      return json(200, { ok: true });
    },
    { roles: GESTORES }
  ),
});

/* ---------- Centros ---------- */
app.http("gestionCentrosListar", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/centros",
  handler: conSesion(
    async () => {
      const pool = await getPool();
      const r = await pool.request().query(
        `SELECT c.CentroId AS id, c.Nombre AS nombre, c.EmpresaId AS empresaId, e.Nombre AS empresa, c.Activo AS activo
           FROM fich.Centros c JOIN fich.Empresas e ON e.EmpresaId = c.EmpresaId
          ORDER BY e.Nombre, c.Nombre`
      );
      return json(200, r.recordset);
    },
    { roles: GESTORES }
  ),
});

app.http("gestionCentrosCrear", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "gestion/centros",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const b = await leerJson(req);
      const nombre = String(b?.nombre ?? "").trim();
      const empresaId = Number(b?.empresaId);
      if (!nombre || !empresaId) return error(400, "Nombre y empresa son obligatorios");
      const pool = await getPool();
      const dup = await pool.request().input("n", sql.NVarChar(150), nombre).input("e", sql.Int, empresaId).query("SELECT 1 FROM fich.Centros WHERE Nombre = @n AND EmpresaId = @e");
      if (dup.recordset.length) return error(409, "Ya existe ese centro en la empresa");
      const r = await pool
        .request()
        .input("n", sql.NVarChar(150), nombre)
        .input("e", sql.Int, empresaId)
        .query("INSERT INTO fich.Centros (EmpresaId, Nombre) OUTPUT INSERTED.CentroId VALUES (@e, @n)");
      const id = r.recordset[0].CentroId;
      await auditar(actor.usuarioId, "CREAR_CENTRO", "Centro", id, `${nombre} empresa=${empresaId}`, ipCliente(req));
      return json(201, { id });
    },
    { roles: GESTORES }
  ),
});
