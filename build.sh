#!/bin/bash
echo Going to build `git rev-parse --short HEAD` image
docker build -t ccr.ccs.tencentyun.com/shuhole/shu-course-calendar:`git rev-parse --short HEAD` --platform linux/amd64 .
if [ $? -ne 0 ]
then
    echo Build failed
    exit 1
fi
echo Built `git rev-parse --short HEAD` image, going to push
echo Logging in
docker login --username=100035268144 ccr.ccs.tencentyun.com
if [ $? -ne 0 ]
then
    echo Login failed
    exit 1
fi
echo Pushing
docker push ccr.ccs.tencentyun.com/shuhole/shu-course-calendar:`git rev-parse --short HEAD`
if [ $? -ne 0 ]
then
    echo Push failed
    exit 1
fi
echo Pushed `git rev-parse --short HEAD` image