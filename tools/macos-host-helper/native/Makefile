# Build the clinemm-host-helper C binary.
# Usage: make         -> build ./helper
#        make clean   -> remove ./helper
CC      ?= cc
CFLAGS  ?= -O2 -Wall -Wextra
SRC      = helper.c
OUT      = helper

# Auto-detect SDK include path on macOS when <launch.h> is missing.
SDK_INC :=
ifeq ($(shell uname -s),Darwin)
ifeq ($(shell echo '#include <launch.h>' | $(CC) -E - >/dev/null 2>&1 && echo yes),)
SDK_PATH := $(shell xcrun --show-sdk-path --sdk macosx 2>/dev/null)
ifneq ($(SDK_PATH),)
SDK_INC := -I$(SDK_PATH)/usr/include
endif
endif
endif

all: $(OUT)

$(OUT): $(SRC)
	$(CC) $(CFLAGS) $(SDK_INC) -o $(OUT) $(SRC)

clean:
	rm -f $(OUT)

.PHONY: all clean
