import { getPool, sql } from "./db";

export async function auditar(
  actorUsuarioId: number | null,
  accion: string,
  entidad: string,
  entidadId: string | number | null,
  detalle: string | null,
  ip: string | null,
  tx?: sql.Transaction
) {
  const req = tx ? new sql.Request(tx) : (await getPool()).request();
  await req
    .input("actor", sql.Int, actorUsuarioId)
    .input("accion", sql.VarChar(50), accion)
    .input("entidad", sql.VarChar(50), entidad)
    .input("entidadId", sql.VarChar(50), entidadId === null ? null : String(entidadId))
    .input("detalle", sql.NVarChar(2000), detalle ? detalle.slice(0, 2000) : null)
    .input("ip", sql.VarChar(45), ip)
    .query(
      `INSERT INTO fich.Auditoria (ActorUsuarioId, Accion, Entidad, EntidadId, Detalle, IpOrigen)
       VALUES (@actor, @accion, @entidad, @entidadId, @detalle, @ip)`
    );
}
