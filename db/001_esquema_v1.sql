/* =====================================================================
   App de Fichajes - Grupo Arquisocial
   Script 001 - Esquema v1
   Ejecutar en: sqldb-fichajes-test (y después en sqldb-fichajes-prod)
   Herramienta: Query editor del portal (login con Entra) o SSMS
   ===================================================================== */

SET XACT_ABORT ON;
GO

CREATE SCHEMA fich AUTHORIZATION dbo;
GO

/* ---------- Empresas ---------- */
CREATE TABLE fich.Empresas (
    EmpresaId     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Empresas PRIMARY KEY,
    Nombre        NVARCHAR(100) NOT NULL CONSTRAINT UQ_Empresas_Nombre UNIQUE,
    Activa        BIT NOT NULL CONSTRAINT DF_Empresas_Activa DEFAULT (1),
    CreadoUtc     DATETIME2(0) NOT NULL CONSTRAINT DF_Empresas_Creado DEFAULT (SYSUTCDATETIME())
);
GO

INSERT INTO fich.Empresas (Nombre) VALUES (N'Arquisocial'), (N'Sanivida'), (N'Fepas');
GO

/* ---------- Centros de trabajo ---------- */
CREATE TABLE fich.Centros (
    CentroId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Centros PRIMARY KEY,
    EmpresaId     INT NOT NULL CONSTRAINT FK_Centros_Empresas REFERENCES fich.Empresas(EmpresaId),
    Nombre        NVARCHAR(150) NOT NULL,
    Activo        BIT NOT NULL CONSTRAINT DF_Centros_Activo DEFAULT (1),
    CreadoUtc     DATETIME2(0) NOT NULL CONSTRAINT DF_Centros_Creado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT UQ_Centros_Empresa_Nombre UNIQUE (EmpresaId, Nombre)
);
GO

/* ---------- Usuarios (autenticación propia, sin cuenta Microsoft) ---------- */
CREATE TABLE fich.Usuarios (
    UsuarioId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Usuarios PRIMARY KEY,
    Email             NVARCHAR(254) NOT NULL,
    EmailNormalizado  AS LOWER(LTRIM(RTRIM(Email))) PERSISTED,
    Nombre            NVARCHAR(100) NOT NULL,
    Apellidos         NVARCHAR(150) NOT NULL,
    EmpresaId         INT NOT NULL CONSTRAINT FK_Usuarios_Empresas REFERENCES fich.Empresas(EmpresaId),
    CentroId          INT NULL     CONSTRAINT FK_Usuarios_Centros REFERENCES fich.Centros(CentroId),
    Rol               VARCHAR(20) NOT NULL CONSTRAINT DF_Usuarios_Rol DEFAULT ('EMPLEADO'),
    PasswordHash      VARCHAR(255) NOT NULL,
    DebeCambiarPassword BIT NOT NULL CONSTRAINT DF_Usuarios_DebeCambiar DEFAULT (1),
    Activo            BIT NOT NULL CONSTRAINT DF_Usuarios_Activo DEFAULT (1),
    IntentosFallidos  INT NOT NULL CONSTRAINT DF_Usuarios_Intentos DEFAULT (0),
    BloqueadoHastaUtc DATETIME2(0) NULL,
    VersionSesion     INT NOT NULL CONSTRAINT DF_Usuarios_VersionSesion DEFAULT (1),
    UltimoAccesoUtc   DATETIME2(0) NULL,
    CreadoUtc         DATETIME2(0) NOT NULL CONSTRAINT DF_Usuarios_Creado DEFAULT (SYSUTCDATETIME()),
    ModificadoUtc     DATETIME2(0) NOT NULL CONSTRAINT DF_Usuarios_Modificado DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Usuarios_Rol CHECK (Rol IN ('EMPLEADO','RESPONSABLE','RRHH','ADMIN'))
);
GO

CREATE UNIQUE INDEX UX_Usuarios_EmailNormalizado ON fich.Usuarios(EmailNormalizado);
GO

/* ---------- Fichajes (LEDGER append-only: no se pueden modificar ni borrar) ----------
   Las correcciones se harán en v2 con una tabla de incidencias que referencia
   el fichaje original, nunca modificándolo. */
CREATE TABLE fich.Fichajes (
    FichajeId     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Fichajes PRIMARY KEY,
    UsuarioId     INT NOT NULL CONSTRAINT FK_Fichajes_Usuarios REFERENCES fich.Usuarios(UsuarioId),
    Tipo          VARCHAR(20) NOT NULL,
    FechaHoraUtc  DATETIME2(0) NOT NULL CONSTRAINT DF_Fichajes_FechaHora DEFAULT (SYSUTCDATETIME()),
    Origen        VARCHAR(20) NOT NULL CONSTRAINT DF_Fichajes_Origen DEFAULT ('WEB'),
    IpOrigen      VARCHAR(45) NULL,
    UserAgent     NVARCHAR(400) NULL,
    CONSTRAINT CK_Fichajes_Tipo CHECK (Tipo IN ('ENTRADA','SALIDA','PAUSA_INICIO','PAUSA_FIN'))
)
WITH (LEDGER = ON (APPEND_ONLY = ON));
GO

CREATE INDEX IX_Fichajes_Usuario_Fecha ON fich.Fichajes(UsuarioId, FechaHoraUtc DESC);
GO

/* ---------- Auditoría (LEDGER append-only) ---------- */
CREATE TABLE fich.Auditoria (
    AuditoriaId   BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Auditoria PRIMARY KEY,
    FechaHoraUtc  DATETIME2(0) NOT NULL CONSTRAINT DF_Auditoria_FechaHora DEFAULT (SYSUTCDATETIME()),
    ActorUsuarioId INT NULL,
    Accion        VARCHAR(50) NOT NULL,
    Entidad       VARCHAR(50) NOT NULL,
    EntidadId     VARCHAR(50) NULL,
    Detalle       NVARCHAR(2000) NULL,
    IpOrigen      VARCHAR(45) NULL
)
WITH (LEDGER = ON (APPEND_ONLY = ON));
GO

CREATE INDEX IX_Auditoria_Fecha ON fich.Auditoria(FechaHoraUtc DESC);
GO

/* ---------- Usuario de base de datos para la API (mínimo privilegio) ----------
   Sustituir <CONTRASEÑA_APP> por una contraseña robusta ANTES de ejecutar este bloque.
   Esta contraseña es la que irá en la cadena de conexión de la Static Web App. */
CREATE USER app_fichajes WITH PASSWORD = N'<CONTRASEÑA_APP>';
GO
GRANT SELECT                 ON fich.Empresas  TO app_fichajes;
GRANT SELECT, INSERT, UPDATE ON fich.Centros   TO app_fichajes;
GRANT SELECT, INSERT, UPDATE ON fich.Usuarios  TO app_fichajes;
GRANT SELECT, INSERT         ON fich.Fichajes  TO app_fichajes;
GRANT SELECT, INSERT         ON fich.Auditoria TO app_fichajes;
GO
