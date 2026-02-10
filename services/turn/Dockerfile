FROM alpine:3.19

RUN apk add --no-cache coturn ca-certificates

COPY services/turn/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3478/tcp 3478/udp
EXPOSE 49160-49200/udp

CMD ["/entrypoint.sh"]
