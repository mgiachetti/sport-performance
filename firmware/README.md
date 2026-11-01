# firmware

Firmware propio del pod GNSS + IMU por jugador (Fase 3), sobre hardware genérico (RAK WisBlock).

No forma parte del workspace de pnpm: tiene su propia toolchain, que se define cuando arranque la Fase 3. El crudo que genera el pod va a storage como archivo; a Postgres solo llegan métricas derivadas.
