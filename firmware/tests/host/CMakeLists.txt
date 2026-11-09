# Host tests of the portable pod library (firmware/lib), plain C with any compiler:
#
#   cmake -S firmware/tests/host -B build/host && cmake --build build/host && ctest --test-dir build/host
#
# The golden fixtures of packages/pod-protocol are turned into a C header at build time.
cmake_minimum_required(VERSION 3.20)
project(pod_firmware_host_tests C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

get_filename_component(FIRMWARE_DIR "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)
set(POD_FIXTURES_DIR "${FIRMWARE_DIR}/../packages/pod-protocol/fixtures/v1"
    CACHE PATH "packages/pod-protocol/fixtures/v1")

find_package(Python3 REQUIRED COMPONENTS Interpreter)

set(FIXTURES_HEADER "${CMAKE_CURRENT_BINARY_DIR}/generated/fixtures_v1.h")
add_custom_command(
  OUTPUT "${FIXTURES_HEADER}"
  COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/generated"
  COMMAND Python3::Interpreter "${FIRMWARE_DIR}/tools/gen_fixtures.py" "${POD_FIXTURES_DIR}"
          "${FIXTURES_HEADER}"
  DEPENDS "${FIRMWARE_DIR}/tools/gen_fixtures.py" "${POD_FIXTURES_DIR}/vectors.json"
          "${POD_FIXTURES_DIR}/log-vectors.json"
  COMMENT "Generating fixtures_v1.h from packages/pod-protocol/fixtures/v1")

add_executable(pod_host_tests
  main.c
  test_crypto.c
  test_radio.c
  test_log.c
  test_gnss.c
  test_led.c
  test_power.c
  test_time_base.c
  "${FIXTURES_HEADER}"
  "${FIRMWARE_DIR}/lib/src/crypto_soft.c"
  "${FIRMWARE_DIR}/lib/src/crypto_selftest.c"
  "${FIRMWARE_DIR}/lib/src/radio.c"
  "${FIRMWARE_DIR}/lib/src/log.c"
  "${FIRMWARE_DIR}/lib/src/gnss.c"
  "${FIRMWARE_DIR}/lib/src/led.c"
  "${FIRMWARE_DIR}/lib/src/power.c"
  "${FIRMWARE_DIR}/lib/src/time_base.c")

target_include_directories(pod_host_tests PRIVATE
  "${FIRMWARE_DIR}/lib/include" "${CMAKE_CURRENT_BINARY_DIR}/generated" "${CMAKE_CURRENT_LIST_DIR}")

if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(pod_host_tests PRIVATE
    -Wall -Wextra -Werror -Wshadow -Wstrict-prototypes -Wno-missing-field-initializers
    -fsanitize=address,undefined -fno-omit-frame-pointer)
  target_link_options(pod_host_tests PRIVATE -fsanitize=address,undefined)
endif()

enable_testing()
add_test(NAME pod_host_tests COMMAND pod_host_tests)
