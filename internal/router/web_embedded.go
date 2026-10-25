//go:build embedweb

package router

import (
	webassets "github.com/MARETU01/gothrough"
	"github.com/gin-gonic/gin"
)

func setupWeb(r *gin.Engine) { r.NoRoute(webHandler(webassets.Assets())) }
