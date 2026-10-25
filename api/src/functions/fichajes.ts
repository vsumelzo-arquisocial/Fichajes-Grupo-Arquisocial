import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { ipCliente } from "../lib/auth";
import { json, error, leerJson, conSesion } from "../lib/http";
import { estadoTras, accionesPermitidas, resumirPorDia, fechaLocal, TipoFichaje } from "../lib/jornada";

const TZ = () => process.env.TZ_APP || "Europe/Madrid";
const TIPOS: TipoFichaje[] = ["ENTRADA", "SALIDA", "PAUSA_INICIO", "PAUSA_FIN"];

async function ultimoFichaje(req: sql.Request, usuarioId: number) {
  const r = await req
    .input("uid", sql.Int, usuarioId)
    .query("SELECT TOP 1 Tipo, FechaHoraUtc FROM fich.Fichajes WHERE UsuarioId = @uid ORDER BY FechaHoraUtc DESC, FichajeId DESC");
  return r.recordset[0] as { Tipo: TipoFichaje; FechaHoraUtc: Date } | undefined;
}

/* ---------- Estado actual + resumen de hoy ---------- */
app.http("fichajeEstado", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "fichajes/estado",
  handler: conSesion(async (_req, _ctx, u) => {
    const pool = await getPool();
    const ultimo = await ultimoFichaje(pool.request(), u.usuarioId);
    const estado = estadoTras(ultimo?.Tipo ?? null);

    // Fichajes desde hace 36 h para cubrir el día local completo y turnos que cruzan medianoche
    const r = await pool
      .request()
      .input("uid", sql.Int, u.usuarioId)
      .query(
        `SELECT Tipo, FechaHoraUtc FROM fich.Fichajes
          WHERE UsuarioId = @uid AND FechaHoraUtc >= DATEADD(HOUR, -36, SYSUTCDATETIME())
          ORDER BY FechaHoraUtc, FichajeId`
      );
    const resumen = resumirPorDia(
      r.recordset.map((f: any) => ({ tipo: f.Tipo, fechaHoraUtc: f.FechaHoraUtc })),
      TZ()
    );
    const hoy = resumen.find((d) => d.fecha === fechaLocal(new Date(), TZ())) ?? null;

    return json(200, {
      estado,
      acciones: accionesPermitidas(estado),
      ultimo: ultimo ? { tipo: ultimo.Tipo, fechaHoraUtc: ultimo.FechaHoraUtc } : null,
      hoy,
      servidorUtc: new Date().toISOString(),
    });
  }),
});

/* ---------- Fichar ---------- */
app.http("fichar", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "fichajes",
  handler: conSesion(async (req, _ctx, u) => {
    const b = await leerJson(req);
    const tipo = b?.tipo as TipoFichaje;
    if (!TIPOS.includes(tipo)) return error(400, "Tipo de fichaje no válido");

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      // Serializa fichajes concurrentes del mismo usuario
      await new sql.Request(tx).input("uid", sql.Int, u.usuarioId).query("SELECT UsuarioId FROM fich.Usuarios WITH (UPDLOCK, ROWLOCK) WHERE UsuarioId = @uid");
      const ultimo = await ultimoFichaje(new sql.Request(tx), u.usuarioId);
      const estado = estadoTras(ultimo?.Tipo ?? null);
      if (!accionesPermitidas(estado).includes(tipo)) {
        await tx.rollback();
        return error(409, "Ese fichaje no es válido en tu estado actual. Recarga la página.");
      }
      const r = await new sql.Request(tx)
        .input("uid", sql.Int, u.usuarioId)
        .input("tipo", sql.VarChar(20), tipo)
        .input("ip", sql.VarChar(45), ipCliente(req))
        .input("ua", sql.NVarChar(400), (req.headers.get("user-agent") ?? "").slice(0, 400))
        .query(
          `INSERT INTO fich.Fichajes (UsuarioId, Tipo, IpOrigen, UserAgent)
           OUTPUT INSERTED.FichajeId, INSERTED.FechaHoraUtc
           VALUES (@uid, @tipo, @ip, @ua)`
        );
      await tx.commit();
      return json(201, { fichajeId: r.recordset[0].FichajeId, tipo, fechaHoraUtc: r.recordset[0].FechaHoraUtc });
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }
  }),
});

/* ---------- Historial propio ---------- */
app.http("historial", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "fichajes/historial",
  handler: conSesion(async (req, _ctx, u) => {
    const desde = req.query.get("desde");
    const hasta = req.query.get("hasta");
    const reFecha = /^\d{4}-\d{2}-\d{2}$/;
    const hoy = new Date();
    const dDesde = desde && reFecha.test(desde) ? new Date(`${desde}T00:00:00Z`) : new Date(hoy.getTime() - 30 * 86400000);
    const dHasta = hasta && reFecha.test(hasta) ? new Date(`${hasta}T23:59:59Z`) : hoy;
    if (dHasta.getTime() - dDesde.getTime() > 186 * 86400000) return error(400, "El rango máximo es de 6 meses");

    // Margen de 1 día por diferencia horaria; se filtra por fecha local después
    const pool = await getPool();
    const r = await pool
      .request()
      .input("uid", sql.Int, u.usuarioId)
      .input("desde", sql.DateTime2, new Date(dDesde.getTime() - 86400000))
      .input("hasta", sql.DateTime2, new Date(dHasta.getTime() + 86400000))
      .query(
        `SELECT Tipo, FechaHoraUtc FROM fich.Fichajes
          WHERE UsuarioId = @uid AND FechaHoraUtc BETWEEN @desde AND @hasta
          ORDER BY FechaHoraUtc, FichajeId`
      );
    const fDesde = dDesde.toISOString().slice(0, 10);
    const fHasta = dHasta.toISOString().slice(0, 10);
    const dias = resumirPorDia(
      r.recordset.map((f: any) => ({ tipo: f.Tipo, fechaHoraUtc: f.FechaHoraUtc })),
      TZ()
    ).filter((d) => d.fecha >= fDesde && d.fecha <= fHasta);

    return json(200, { desde: fDesde, hasta: fHasta, dias });
  }),
});
