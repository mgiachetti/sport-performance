# Release guard: a release image is never signed with an MCUboot development key, and it
# locks the debug port (APPROTECT) in both MCUboot and the application.
if(SB_CONFIG_POD_RELEASE_BUILD)
  if(NOT SB_CONFIG_BOOTLOADER_MCUBOOT)
    message(FATAL_ERROR "A pod release build needs MCUboot with signed images (ADR 0106).")
  endif()
  set(pod_key "${SB_CONFIG_BOOT_SIGNATURE_KEY_FILE}")
  if("${pod_key}" STREQUAL "" OR NOT EXISTS "${pod_key}")
    message(FATAL_ERROR "Release build without a signing key file (SB_CONFIG_BOOT_SIGNATURE_KEY_FILE).")
  endif()
  # Compare by content, not by path: a copy of a development key elsewhere is still public.
  file(SHA256 "${pod_key}" pod_key_sha)
  file(GLOB pod_dev_keys "${ZEPHYR_MCUBOOT_MODULE_DIR}/root-*.pem")
  foreach(dev_key ${pod_dev_keys})
    file(SHA256 "${dev_key}" dev_sha)
    if("${dev_sha}" STREQUAL "${pod_key_sha}")
      message(FATAL_ERROR
        "Release build signed with the MCUboot development key (${dev_key}). "
        "Pass -DSB_CONFIG_BOOT_SIGNATURE_KEY_FILE=<production key outside the repository>.")
    endif()
  endforeach()
  set_config_bool(${DEFAULT_IMAGE} CONFIG_NRF_APPROTECT_LOCK y)
  set_config_bool(mcuboot CONFIG_NRF_APPROTECT_LOCK y)
endif()
