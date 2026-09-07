import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { join } from 'path';

import configuration from './config/configuration';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermisosGuard } from './common/guards/permisos.guard';
import { InscripcionMfaGuard } from './common/guards/inscripcion-mfa.guard';
import { ContextoEmpresaInterceptor } from './common/interceptors/contexto-empresa.interceptor';
import { IdempotenciaInterceptor } from './common/interceptors/idempotencia.interceptor';
import { AuditoriaInterceptor } from './common/interceptors/auditoria.interceptor';
import { ThrottlingModule } from './common/throttling/throttling.module';
import { RegistroPeticionesMiddleware } from './common/registro/registro-peticiones.middleware';
import { IdDeRutaPipe } from './common/id-de-ruta.pipe';

import { AuthModule } from './modules/auth/auth.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';
import { RolesModule } from './modules/roles/roles.module';
import { EmpresasModule } from './modules/empresas/empresas.module';
import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { DispositivosModule } from './modules/dispositivos/dispositivos.module';
import { SaludModule } from './modules/salud/salud.module';
import { ClientesModule } from './modules/clientes/clientes.module';
import { EstacionesModule } from './modules/estaciones/estaciones.module';
import { ProductosModule } from './modules/productos/productos.module';
import { VehiculosModule } from './modules/vehiculos/vehiculos.module';
import { CisternasModule } from './modules/cisternas/cisternas.module';
import { ConductoresModule } from './modules/conductores/conductores.module';
import { OrdenesModule } from './modules/ordenes/ordenes.module';
import { ViajesModule } from './modules/viajes/viajes.module';
import { EntregasModule } from './modules/entregas/entregas.module';
import { SolicitudesRutaModule } from './modules/solicitudes-ruta/solicitudes-ruta.module';
import { GastosModule } from './modules/gastos/gastos.module';
import { InformesModule } from './modules/informes/informes.module';

@Module({
  imports: [
    // Fase 1A · catálogos, flota y conductores
    ClientesModule, EstacionesModule, ProductosModule,
    VehiculosModule, CisternasModule, ConductoresModule,
    // Fase 1B · órdenes, viajes y plan de carga
    OrdenesModule, ViajesModule,
    EntregasModule,
    SolicitudesRutaModule,
    GastosModule,
    InformesModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: [join(__dirname, '../../.env'), '.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        database: config.get<string>('database.name'),
        // El rol restringido, no el dueño: si la aplicación se conectara como
        // dueño evadiría sus propias políticas RLS y ADR 003 sería decorativo.
        username: config.get<string>('database.user'),
        password: config.get<string>('database.password'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    AuthModule,
    // Después de AuthModule: su factoría inyecta el REDIS que aquél exporta.
    ThrottlingModule,
    UsuariosModule,
    RolesModule,
    EmpresasModule,
    AuditoriaModule,
    DispositivosModule,
    SaludModule,
  ],
  providers: [
    // Un identificador de ruta con basura tiene que ser un 400, no el 500 que
    // producía el bigint de Postgres al recibirlo. Aquí y no en main.ts para
    // que las pruebas, que montan este módulo, lo ejerciten igual.
    { provide: APP_PIPE, useClass: IdDeRutaPipe },

    // Guards: autenticar y luego autorizar. Corren ANTES que los interceptores,
    // que es lo que permite al de contexto leer request.user.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Entre ambos: necesita el usuario que resuelve JwtAuthGuard, y tiene que
    // cortar antes que PermisosGuard para dar el motivo real del rechazo (§7).
    { provide: APP_GUARD, useClass: InscripcionMfaGuard },
    { provide: APP_GUARD, useClass: PermisosGuard },

    // Interceptores: el orden de registro es el orden de anidamiento, y aquí
    // importa. Contexto abre la transacción y fija app.empresa_id; idempotencia
    // y auditoría escriben DENTRO de esa transacción, así que si la petición
    // falla se revierten con ella. Al revés quedaría una clave de idempotencia
    // consumida por una operación que nunca ocurrió: el reintento legítimo
    // recibiría la respuesta de un fantasma.
    { provide: APP_INTERCEPTOR, useClass: ContextoEmpresaInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotenciaInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditoriaInterceptor },
  ],
})
export class AppModule implements NestModule {
  /**
   * A TODA ruta, incluida la que no existe. Un 404 repetido contra rutas que
   * nadie tiene por qué pedir es de las señales más baratas que hay para ver
   * a alguien tanteando el servidor, y filtrarlo aquí sería tirarla.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RegistroPeticionesMiddleware).forRoutes('*');
  }
}
