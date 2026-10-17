# Build the clinemm-host-helper C binary.
#
# ACT-CLINEMM-TART-P4.1-C1-GO-NATIVE-HELPER-ATOMIC-BUILD01:
# The atomic-build + codesign re-sign + variant-separation logic
# is implemented in build.sh. This Makefile is a thin convenience
# wrapper that delegates to build.sh for both targets so the two
# paths share one code path. Do not reimplement the build here —
# the bash script is the source of truth.
#
# Usage:
#   make            -> build ./helper
#   make ablated    -> build ./helper.ablated (separate path;
#                                       canonical ./helper is NEVER
#                                       replaced)
#   make clean      -> remove ./helper AND ./helper.ablated
#
# Review-correction01: -Wno-error=implicit-function-declaration +
# -Wno-implicit-function-declaration are removed. The helper source
# uses proper forward declarations for every helper it calls.
# Implicit declarations are a security-sensitive diagnostic for a
# sandbox-bound native helper — they should be errors, not warnings.

.PHONY: all canonical ablated clean

all: canonical

canonical:
	./build.sh

ablated:
	CLINEMM_HELPER_BUILD_VARIANT=ablated ./build.sh

clean:
	rm -f helper helper.ablated .helper.unsigned.tmp.* .helper.ablated.unsigned.tmp.*
