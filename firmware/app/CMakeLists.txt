# Pod firmware (B-904): Zephyr application on the nRF Connect SDK.
#
#   west build -b pod_v0/nrf52840 sport-performance/firmware/app
#   west build -b nrf52840dk/nrf52840 sport-performance/firmware/app
#
# The custom board lives in app/boards (the application directory is a board root by default).
cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(pod_firmware C)

set(POD_LIB_DIR ${CMAKE_CURRENT_LIST_DIR}/../lib)

target_include_directories(app PRIVATE ${POD_LIB_DIR}/include src)

# Portable library: the same sources the host tests check against the golden fixtures,
# with the PSA backend instead of the reference software crypto.
target_sources(app PRIVATE
  ${POD_LIB_DIR}/src/crypto_psa.c
  ${POD_LIB_DIR}/src/crypto_selftest.c
  ${POD_LIB_DIR}/src/radio.c
  ${POD_LIB_DIR}/src/counters.c
  ${POD_LIB_DIR}/src/log.c
  ${POD_LIB_DIR}/src/gnss.c
  ${POD_LIB_DIR}/src/led.c
  ${POD_LIB_DIR}/src/power.c
  ${POD_LIB_DIR}/src/time_base.c)

# Zephyr glue, one file per module.
target_sources(app PRIVATE
  src/main.c
  src/boot_counter.c
  src/wdt.c
  src/led.c
  src/power.c
  src/hall.c
  src/time_base.c
  src/gnss_lc29h.c
  src/log_nand.c
  src/lora_link.c
  src/sensors.c)

zephyr_compile_definitions(POD_FIRMWARE_VERSION_MAJOR=${APP_VERSION_MAJOR}
                           POD_FIRMWARE_VERSION_MINOR=${APP_VERSION_MINOR}
                           POD_FIRMWARE_VERSION_PATCH=${APP_PATCHLEVEL})
