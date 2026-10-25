//go:build !embedweb

package router

import "github.com/gin-gonic/gin"

func setupWeb(_ *gin.Engine) {}
