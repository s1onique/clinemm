# Build the clinemm-host-helper C binary.
# Usage: make         -> build ./helper
#        make clean   -> remove ./helper
#
# Review-correction01: -Wno-error=implicit-function-declaration +
# -Wno-implicit-function-declaration are removed. The helper source now
# uses proper forward declarations for every helper it calls. Implicit
# declarations are a security-sensitive diagnostic for a sandbox-bound
# native helper — they should be errors, not warnings.
CC      ?= cc
# Compute the embedded build_id (review-correction01). The same
# algorithm is duplicated in build.sh; we keep them in sync because
# Make recipes with $(shell) aren't trivially embedded into CC flags.
ABI_VERSION ?= OWNED_PGID_TERMINATION_01
BUILD_ID    ?= $(shell printf '%s' "$(ABI_VERSION)" | cat - helper.c | shasum -a 256 | awk '{print $$1}')
CFLAGS      ?= -O2 -Wall -Wextra \
               -DCLINEMM_HELPER_ABI_VERSION="\"$(ABI_VERSION)\"" \
               -DCLINEMM_HELPER_BUILD_ID="\"$(BUILD_ID)\""
SRC      = helper.c
OUT      = helper

# Auto-detect SDK include path on macOS when <launch.h> is missing.
SDK_INC :=
ifeq ($(shell uname -s 2>/dev/null),Darwin)
SDK_PATH := $(shell xcrun --show-sdk-path --sdk macosx 2>/dev/null)
ifneq ($(SDK_PATH),)
SDK_INC := -I$(SDK_PATH)/usr/include
endif
endif

all: $(OUT)

$(OUT): $(SRC)
	@echo "[make] embedded build_id=$(BUILD_ID)"
	$(CC) $(CFLAGS) $(SDK_INC) -o $(OUT) $(SRC)

clean:
	rm -f $(OUT)

.PHONY: all clean
