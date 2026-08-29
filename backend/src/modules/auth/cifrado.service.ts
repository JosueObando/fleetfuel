import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifrado simétrico de secretos que la aplicación debe poder volver a leer.
 *
 * Se usa para el secreto TOTP: no puede ser un hash —hay que recalcular el
 * código en cada validación— pero tampoco puede quedar en claro, porque quien
 * obtenga un respaldo de la base podría generar los códigos MFA de cualquiera
 * y el segundo factor dejaría de serlo.
 *
 * AES-256-GCM y no CBC: GCM autentica el texto cifrado, así que un secreto
 * manipulado en la base falla al descifrar en vez de producir basura que se
 * usaría como semilla.
 */
@Injectable()
export class CifradoService {
  private readonly llave: Buffer;

  constructor(config: ConfigService) {
    const secreto = config.get<string>('jwt.secret') ?? '';
    if (config.get<string>('env') === 'production' && secreto.includes('cambiar')) {
      throw new InternalServerErrorException(
        'JWT_SECRET sigue con el valor de ejemplo. No se arranca en producción así.',
      );
    }
    // Deriva 32 bytes del secreto de la aplicación. Con un HSM o un KMS esto
    // se sustituye por la llave gestionada; la interfaz no cambia.
    this.llave = createHash('sha256').update(`fleetfuel:mfa:${secreto}`).digest();
  }

  cifrar(claro: string): string {
    const iv = randomBytes(12);
    const cifrador = createCipheriv('aes-256-gcm', this.llave, iv);
    const datos = Buffer.concat([cifrador.update(claro, 'utf8'), cifrador.final()]);
    // iv.tag.datos — el IV es público por diseño; lo que no puede repetirse.
    return [iv.toString('base64'), cifrador.getAuthTag().toString('base64'), datos.toString('base64')].join('.');
  }

  descifrar(sobre: string): string {
    const [iv, tag, datos] = sobre.split('.');
    if (!iv || !tag || !datos) throw new InternalServerErrorException('Secreto MFA con formato inválido');
    const descifrador = createDecipheriv('aes-256-gcm', this.llave, Buffer.from(iv, 'base64'));
    descifrador.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      descifrador.update(Buffer.from(datos, 'base64')),
      descifrador.final(),
    ]).toString('utf8');
  }
}
