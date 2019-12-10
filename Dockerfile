ARG IMAGE_VERSION_ARG=2019.0.00f0
ARG IMAGE_TARGET_ARG=$1
FROM gableroux/unity3d:${IMAGE_VERSION_ARG}-${IMAGE_TARGET_ARG}

LABEL "com.github.actions.name"="Unity - Builder"
LABEL "com.github.actions.description"="Build Unity projects for different platforms."
LABEL "com.github.actions.icon"="box"
LABEL "com.github.actions.color"="gray-dark"

LABEL "repository"="http://github.com/webbertakken/unity-actions"
LABEL "homepage"="http://github.com/webbertakken/unity-actions"
LABEL "maintainer"="Webber Takken <webber@takken.io>"

ADD default-build-script /UnityBuilderAction
ADD entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
