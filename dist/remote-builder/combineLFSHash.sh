#!/bin/sh

echo "Combining LFS hash files into one hash, this can be used to cache LFS files"
git lfs ls-files -l | cut -d' ' -f1 | sort > $1/lfsSum.txt
echo ''
echo 'combined file:'
cat $1/lfsSum.txt
echo ''
