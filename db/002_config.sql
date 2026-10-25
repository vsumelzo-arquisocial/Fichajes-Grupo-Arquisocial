/* =====================================================================
   Script 002 - Configuración interna (secretos generados en el servidor)
   - JWT_SECRET: clave de firma de sesiones (nunca sale de la BD/API)
   - SETUP_KEY : clave de un solo uso para crear el primer administrador
                 (consúltala con: SELECT Valor FROM fich.Config WHERE Clave = 'SETUP_KEY')
   ===================================================================== */
CREATE TABLE fich.Config (
    Clave VARCHAR(50) NOT NULL CONSTRAINT PK_Config PRIMARY KEY,
    Valor NVARCHAR(500) NOT NULL,
    CreadoUtc DATETIME2(0) NOT NULL CONSTRAINT DF_Config_Creado DEFAULT (SYSUTCDATETIME())
);
INSERT INTO fich.Config (Clave, Valor) VALUES
  ('JWT_SECRET', CONVERT(VARCHAR(200), CRYPT_GEN_RANDOM(64), 2)),
  ('SETUP_KEY',  CONVERT(VARCHAR(40),  CRYPT_GEN_RANDOM(12), 2));
GRANT SELECT, DELETE ON fich.Config TO app_fichajes;
