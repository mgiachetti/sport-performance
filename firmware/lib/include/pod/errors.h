/*
 * Error codes of the portable pod library. They mirror the stable `code` of
 * `PodProtocolError` in packages/pod-protocol (errors.ts) where one exists.
 */
#ifndef POD_ERRORS_H_
#define POD_ERRORS_H_

enum pod_err {
	POD_OK = 0,
	/** A field is outside its range (`field_out_of_range`). */
	POD_ERR_RANGE = -1,
	/** Wrong length or buffer too small (`invalid_length`). */
	POD_ERR_LENGTH = -2,
	/** The MIC / CMAC does not verify (`authentication_failed`, `mac_mismatch`). */
	POD_ERR_AUTH = -3,
	/** Version nibble or format version not supported (`unsupported_version`). */
	POD_ERR_VERSION = -4,
	/** Unknown message or record type (`unknown_type`). */
	POD_ERR_TYPE = -5,
	/** Reserved bits set (`reserved_bits_set`). */
	POD_ERR_RESERVED = -6,
	/** The crypto backend failed (never a protocol condition). */
	POD_ERR_CRYPTO = -7,
	/** Operation not valid in the current state (closed segment, wrong power state…). */
	POD_ERR_STATE = -8,
	/** A counter would wrap: rotate keys at the dock (`boot_counter_exhausted`). */
	POD_ERR_EXHAUSTED = -9,
	/** Malformed input from a peripheral (NMEA without `*`, bad checksum…). */
	POD_ERR_PARSE = -10,
	/** Not implemented yet (stubs that wait for the bench, B-901/B-904). */
	POD_ERR_NOT_IMPLEMENTED = -11,
};

#endif /* POD_ERRORS_H_ */
