// Minimal SPI sender for FieldLinker display
// Simplified: send a single 3600-byte frame with fixed data.

#include <errno.h>
#include <fcntl.h>
#include <linux/spi/spidev.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

#define FRAME_BYTES      3600
#define DEFAULT_DEVICE   "/dev/spidev4.0"
#define DEFAULT_SPEED_HZ (10 * 1000 * 1000)

static int configure_spi(int fd) {
    uint8_t mode = SPI_MODE_3;
    uint32_t speed = DEFAULT_SPEED_HZ;

    if (ioctl(fd, SPI_IOC_WR_MODE, &mode) < 0) {
        perror("SPI_IOC_WR_MODE");
        return -1;
    }
    if (ioctl(fd, SPI_IOC_WR_MAX_SPEED_HZ, &speed) < 0) {
        perror("SPI_IOC_WR_MAX_SPEED_HZ");
        return -1;
    }
    return 0;
}

static int send_frame(int fd, const uint8_t *payload) {
    static uint8_t tx_buf[FRAME_BYTES + 3];

    tx_buf[0] = 0x55;
    tx_buf[1] = 0x5B;
    memcpy(&tx_buf[2], payload, FRAME_BYTES);
    tx_buf[FRAME_BYTES + 2] = 0xAA;

    ssize_t written = write(fd, tx_buf, sizeof(tx_buf));
    if (written < 0) {
        perror("write");
        return -1;
    }
    return 0;
}

int main(void) {
    uint8_t frame[FRAME_BYTES];
    memset(frame, 3, sizeof(frame));

    int fd = open(DEFAULT_DEVICE, O_WRONLY);
    if (fd < 0) {
        perror("open spidev");
        return 1;
    }

    if (configure_spi(fd) < 0) {
        close(fd);
        return 1;
    }

    if (send_frame(fd, frame) < 0) {
        close(fd);
        return 1;
    }

    close(fd);
    return 0;
}
