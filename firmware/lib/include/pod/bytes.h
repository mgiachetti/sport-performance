/*
 * Little-endian byte helpers shared by the radio and the NAND log formats
 * (packages/pod-protocol/README.md: every multi-byte integer is little-endian).
 *
 * Portable C99: no Zephyr headers, so the host tests build them with any compiler.
 */
#ifndef POD_BYTES_H_
#define POD_BYTES_H_

#include <stddef.h>
#include <stdint.h>

/** Writer over a caller buffer. `overflow` latches when a write would not fit. */
struct pod_writer {
	uint8_t *buf;
	size_t cap;
	size_t len;
	int overflow;
};

static inline void pod_writer_init(struct pod_writer *w, uint8_t *buf, size_t cap)
{
	w->buf = buf;
	w->cap = cap;
	w->len = 0;
	w->overflow = 0;
}

static inline void pod_put_u8(struct pod_writer *w, uint32_t v)
{
	if (w->len + 1 > w->cap) {
		w->overflow = 1;
		return;
	}
	w->buf[w->len++] = (uint8_t)(v & 0xffu);
}

static inline void pod_put_le(struct pod_writer *w, uint64_t v, unsigned int bytes)
{
	if (w->len + bytes > w->cap) {
		w->overflow = 1;
		return;
	}
	for (unsigned int i = 0; i < bytes; i++) {
		w->buf[w->len++] = (uint8_t)((v >> (8u * i)) & 0xffu);
	}
}

static inline void pod_put_u16(struct pod_writer *w, uint32_t v) { pod_put_le(w, v, 2); }
static inline void pod_put_u24(struct pod_writer *w, uint32_t v) { pod_put_le(w, v, 3); }
static inline void pod_put_u32(struct pod_writer *w, uint32_t v) { pod_put_le(w, v, 4); }
static inline void pod_put_u48(struct pod_writer *w, uint64_t v) { pod_put_le(w, v, 6); }
static inline void pod_put_i8(struct pod_writer *w, int32_t v) { pod_put_u8(w, (uint32_t)v & 0xffu); }
static inline void pod_put_i16(struct pod_writer *w, int32_t v)
{
	pod_put_le(w, (uint32_t)v & 0xffffu, 2);
}
static inline void pod_put_i32(struct pod_writer *w, int32_t v) { pod_put_le(w, (uint32_t)v, 4); }

static inline void pod_put_raw(struct pod_writer *w, const uint8_t *src, size_t n)
{
	if (w->len + n > w->cap) {
		w->overflow = 1;
		return;
	}
	for (size_t i = 0; i < n; i++) {
		w->buf[w->len++] = src[i];
	}
}

static inline uint32_t pod_get_le(const uint8_t *p, unsigned int bytes)
{
	uint32_t v = 0;

	for (unsigned int i = 0; i < bytes; i++) {
		v |= (uint32_t)p[i] << (8u * i);
	}
	return v;
}

static inline uint16_t pod_get_u16(const uint8_t *p) { return (uint16_t)pod_get_le(p, 2); }
static inline uint32_t pod_get_u32(const uint8_t *p) { return pod_get_le(p, 4); }

#endif /* POD_BYTES_H_ */
