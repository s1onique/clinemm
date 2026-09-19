# Build the ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01 probes.
# These are diagnostic binaries used by the discriminator ACT ONLY.
# They are intentionally outside the production helper protocol.
#
# Usage: make        -> build all probe binaries
#        make clean  -> remove built binaries

CC      ?= cc
CFLAGS  ?= -O2 -Wall -Wextra
SRC_DIR := .
OUT_DIR := .

# Auto-detect SDK include path on macOS when <launch.h> is missing.
SDK_INC :=
ifeq ($(shell uname -s 2>/dev/null),Darwin)
SDK_PATH := $(shell xcrun --show-sdk-path --sdk macosx 2>/dev/null)
ifneq ($(SDK_PATH),)
SDK_INC := -I$(SDK_PATH)/usr/include
endif
endif

ALL_CFLAGS = $(CFLAGS) $(SDK_INC)

PROBES = \
  20-mechb-kqueue-probe \
  22-mechb-cross-process-test \
  22-mechb-emulator \
  22-mechb-self-fork-test \
  23-mechb-full-test \
  30-helper-preattach-driver \
  31-helper-preattach-root \
  32-helper-preattach-emulator \
  40-oracle-lossless-witness \
  41-oracle-broken-channel-witness \
  42-oracle-descendant-failure-witness

.PHONY: all clean
all: $(PROBES)

$(PROBES): %: %.c
	$(CC) $(ALL_CFLAGS) -o $@ $<

clean:
	rm -f $(PROBES)
