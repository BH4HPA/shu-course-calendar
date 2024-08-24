#!/bin/bash
docker login --username=100035268144 ccr.ccs.tencentyun.com
docker tag shu-course-calendar:latest ccr.ccs.tencentyun.com/shuhole/shu-course-calendar:latest
docker push ccr.ccs.tencentyun.com/shuhole/shu-course-calendar:latest