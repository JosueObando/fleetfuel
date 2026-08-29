import { SetMetadata } from '@nestjs/common';

export const PERMITE_INSCRIPCION_MFA = 'permiteInscripcionMfa';

/**
 * Marca los pocos endpoints que una sesión de inscripción MFA sí puede tocar.
 *
 * Es una lista de permitidos, no de prohibidos: un endpoint nuevo queda cerrado
 * a estas sesiones por omisión. Al revés —abrir por omisión y cerrar a mano— el
 * §7 se rompe cada vez que alguien añade una ruta y no se acuerda de esto.
 */
export const PermiteInscripcionMfa = () => SetMetadata(PERMITE_INSCRIPCION_MFA, true);
