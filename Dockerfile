FROM ubuntu:latest
LABEL authors="sh2"

ENTRYPOINT ["top", "-b"]