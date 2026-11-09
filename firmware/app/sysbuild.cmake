# Guard: a release build never signs with MCUboot's public development key.
if(SB_CONFIG_POD_RELEASE_BUILD)
  if(NOT SB_CONFIG_BOOTLOADER_MCUBOOT)
    message(FATAL_ERROR "A pod release build needs MCUboot with signed images (ADR 0106).")
  endif()
  get_filename_component(pod_key "${SB_CONFIG_BOOT_SIGNATURE_KEY_FILE}" ABSOLUTE)
  get_filename_component(pod_key_dir "${pod_key}" DIRECTORY)
  get_filename_component(pod_mcuboot_dir "${ZEPHYR_MCUBOOT_MODULE_DIR}" ABSOLUTE)
  if("${SB_CONFIG_BOOT_SIGNATURE_KEY_FILE}" STREQUAL "" OR
     "${pod_key_dir}" STREQUAL "${pod_mcuboot_dir}")
    message(FATAL_ERROR
      "Release build signed with the MCUboot development key (${SB_CONFIG_BOOT_SIGNATURE_KEY_FILE}). "
      "Pass -DSB_CONFIG_BOOT_SIGNATURE_KEY_FILE=<production key outside the repository>.")
  endif()
endif()
