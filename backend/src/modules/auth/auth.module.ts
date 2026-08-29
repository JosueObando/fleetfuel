import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import Redis from 'ioredis';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { CifradoService } from './cifrado.service';
import { REDIS, TokensService } from './tokens.service';
import { JwtStrategy } from './jwt.strategy';

@Global()
@Module({
  imports: [PassportModule, JwtModule.register({}), ConfigModule],
  controllers: [AuthController],
  providers: [
    AuthService, MfaService, CifradoService, TokensService, JwtStrategy,
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        }),
    },
  ],
  exports: [AuthService, TokensService, CifradoService],
})
export class AuthModule {}
