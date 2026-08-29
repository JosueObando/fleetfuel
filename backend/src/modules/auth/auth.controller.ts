import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { LoginDto } from './dto/login.dto';
import { RefrescarDto } from './dto/refrescar.dto';
import { ConfirmarMfaDto } from './dto/mfa.dto';
import { Publico } from '../../common/decorators/publico.decorator';
import { SinIdempotencia } from '../../common/decorators/sin-idempotencia.decorator';
import { UsuarioActual, UsuarioAutenticado } from '../../common/decorators/usuario-actual.decorator';
import { Ip } from '@nestjs/common';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Publico()
  @SinIdempotencia()
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto, ip);
  }

  @Publico()
  @SinIdempotencia()
  @HttpCode(200)
  @Post('refrescar')
  refrescar(@Body() dto: RefrescarDto) {
    return this.auth.refrescar(dto.refreshToken);
  }

  @Publico()
  @SinIdempotencia()
  @HttpCode(204)
  @Post('cerrar-sesion')
  async cerrarSesion(@Body() dto: RefrescarDto) {
    await this.auth.cerrarSesion(dto.refreshToken);
  }

  @Get('yo')
  yo(@UsuarioActual() usuario: UsuarioAutenticado) {
    return usuario;
  }

  @SinIdempotencia()
  @HttpCode(200)
  @Post('mfa/iniciar')
  iniciarMfa(@UsuarioActual() usuario: UsuarioAutenticado) {
    return this.mfa.iniciar(usuario.id, usuario.correo);
  }

  @SinIdempotencia()
  @HttpCode(200)
  @Post('mfa/confirmar')
  confirmarMfa(@UsuarioActual() usuario: UsuarioAutenticado, @Body() dto: ConfirmarMfaDto) {
    return this.mfa.confirmar(usuario.id, dto.codigoTotp);
  }
}
